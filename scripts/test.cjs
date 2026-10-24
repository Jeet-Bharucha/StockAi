'use strict';
const {spawnSync}=require('node:child_process');
const {readdirSync}=require('node:fs');
const files=readdirSync('tests').filter(name=>name.endsWith('.test.cjs')).map(name=>'tests/'+name);
const run=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});process.exitCode=run.status??1;
