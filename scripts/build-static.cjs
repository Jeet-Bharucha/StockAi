'use strict';
const fs=require('node:fs'),path=require('node:path'),{isAllowedPublicPath}=require('../siteSecurity');
function buildStatic(root=path.resolve(__dirname,'..'),output=path.join(root,'.stockai-static')){
 fs.mkdirSync(output,{recursive:true});let count=0;
 function visit(dir,relative=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const rel=relative?relative+'/'+entry.name:entry.name;if(entry.isSymbolicLink())continue;if(entry.isDirectory()){if((!relative&&['css','js','assets','images','img','icons','fonts'].includes(entry.name))||relative)visit(path.join(dir,entry.name),rel);}else if(isAllowedPublicPath('/'+rel)){const target=path.join(output,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(dir,entry.name),target);count++;}}}
 visit(root);return count;
}
if(require.main===module)console.log('Published frontend files:',buildStatic());module.exports={buildStatic};
