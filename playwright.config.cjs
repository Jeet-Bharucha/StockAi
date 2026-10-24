'use strict';
if(process.platform==='win32'&&!process.env.PLAYWRIGHT_BROWSERS_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=require('node:path').resolve('.playwright-browsers');
const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({testDir:'./e2e',timeout:45000,expect:{timeout:10000},fullyParallel:false,workers:1,retries:process.env.CI?1:0,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:4188',serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
 globalSetup:'./scripts/browserTestServer.cjs'});
