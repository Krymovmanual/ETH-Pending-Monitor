const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./fixture');

test('gas analytics returns weekday and hourly distributions',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const metric=value=>({min:value-1,avg:value,median:value,max:value+2});
  for(let day=0;day<8;day+=1)for(let hour=0;hour<24;hour+=6){
    const value=5+day+hour/4;
    await f.db.saveGasMinute({minute:new Date(Date.now()-(day*24+hour)*3600000),sampleCount:1,base:metric(value*.8),low:metric(value*.9),standard:metric(value),fast:metric(value*1.2)});
  }
  const user=await f.register('gas@example.test');
  const response=await user.client.call('/api/gas-analytics');
  assert.equal(response.status,200);
  assert.ok(response.data.distributions.weekday.length>=7);
  assert.ok(response.data.distributions.hour.length>=4);
  for(const row of response.data.distributions.weekday)assert.ok(['minimum','q1','median','q3','maximum'].every(key=>Number.isFinite(row[key])));
});
