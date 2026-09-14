const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./fixture');

function invitationToken(messages,email){
  const message=messages.filter(item=>item.to[0]===email).at(-1);
  return message?.html.match(/#invite=([A-Za-z0-9_-]+)/)?.[1];
}

test('organization workspaces share treasury data and enforce roles',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const owner=await f.register('owner@example.test');
  const viewer=await f.register('viewer@example.test');
  const address='0x'+'d'.repeat(40);
  assert.equal((await owner.client.call('/api/settings','PUT',{addresses:[address]})).status,200);

  const ownerMe=await owner.client.call('/api/auth/me');
  assert.equal(ownerMe.data.organization.role,'owner');
  assert.equal(ownerMe.data.organizations.length,1);
  const ownerOrganizationId=ownerMe.data.organization.id;

  let response=await owner.client.call('/api/organizations/invitations','POST',{email:viewer.email,role:'viewer'});
  assert.equal(response.status,201);
  const token=invitationToken(f.mails,viewer.email);assert.ok(token);
  response=await viewer.client.call('/api/organizations/invitations/accept','POST',{token});
  assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.organization.id,ownerOrganizationId);

  const viewerMe=await viewer.client.call('/api/auth/me');
  assert.equal(viewerMe.data.organization.role,'viewer');
  assert.equal(viewerMe.data.organizations.length,2);
  assert.deepEqual((await viewer.client.call('/api/settings')).data.addresses,[address]);
  response=await viewer.client.call('/api/settings','PUT',{addresses:[]});
  assert.equal(response.status,403);assert.equal(response.data.code,'ROLE_REQUIRED');
  assert.equal((await viewer.client.call('/api/organizations/audit')).status,403);

  response=await owner.client.call('/api/organizations/members/'+viewer.id,'PATCH',{role:'admin'});
  assert.equal(response.status,200);
  response=await viewer.client.call('/api/settings','PUT',{addresses:[]});
  assert.equal(response.status,200);
  assert.deepEqual((await owner.client.call('/api/settings')).data.addresses,[]);

  const audit=await owner.client.call('/api/organizations/audit');
  assert.equal(audit.status,200);
  assert.ok(audit.data.items.some(item=>item.event==='invitation_accepted'));
  assert.ok(audit.data.items.some(item=>item.event==='member_role_changed'));
  assert.ok(audit.data.items.some(item=>item.event==='settings_updated'&&item.actor_email===viewer.email));

  const personal=viewerMe.data.organizations.find(item=>item.id!==ownerOrganizationId);
  assert.ok(personal);
  assert.equal((await viewer.client.call('/api/organizations/switch','POST',{organizationId:personal.id})).status,200);
  const switched=await viewer.client.call('/api/auth/me');
  assert.equal(switched.data.organization.id,personal.id);assert.equal(switched.data.organization.role,'owner');
  assert.deepEqual((await viewer.client.call('/api/settings')).data.addresses,[]);
  response=await viewer.client.call('/api/settings','PUT',{addresses:[address]},{'X-Workspace-Organization':ownerOrganizationId});
  assert.equal(response.status,409);assert.equal(response.data.code,'WORKSPACE_CHANGED');
});
