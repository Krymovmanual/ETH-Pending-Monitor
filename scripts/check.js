const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(file.endsWith('.js')){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status)process.exit(result.status);}}}
for(const dir of ['server','docs','tests'])walk(path.join(__dirname,'..',dir));
console.log('JavaScript syntax checks passed.');
