'use strict';
function match(doc,query){
 const at=(obj,key)=>key.split('.').reduce((o,k)=>o?.[k],obj);
 return Object.entries(query).every(([key,value])=>{
  if(key==='$or')return value.some(q=>match(doc,q));
  const actual=at(doc,key);if(value&&typeof value==='object'&&!(value instanceof Date)&&!Array.isArray(value)){
   return Object.entries(value).every(([op,v])=>op==='$exists'?(actual!==undefined)===v:op==='$lt'?actual!==undefined&&actual<v:op==='$gte'?actual>=v:op==='$nin'?!v.includes(actual):actual===value);
  }
  return String(actual)===String(value);
 });
}
function memoryModel(unique=[]){let records=[],id=0;
 function apply(doc,ops){Object.assign(doc,ops.$set||{});for(const[k,v]of Object.entries(ops.$inc||{}))doc[k]=(doc[k]||0)+v;for(const[k,v]of Object.entries(ops.$push||{}))(doc[k]??=[]).push(v);for(const k of Object.keys(ops.$unset||{}))delete doc[k];return doc;}
 function query(fn,many=false){let sort=null,limit=Infinity;const q={sort(v){sort=v;return q;},limit(v){limit=v;return q;},select(){return q;},async lean(){let result=fn();if(many){if(sort)result.sort((a,b)=>{for(const[k,d]of Object.entries(sort)){if(a[k]===b[k])continue;if(a[k]===undefined)return -d;if(b[k]===undefined)return d;return (a[k]<b[k]?-1:1)*d;}return 0;});result=result.slice(0,limit);}return structuredClone(result);},then(a,b){return q.lean().then(a,b);}};return q;}
 return {records,
  async create(doc){if(unique.some(key=>records.some(r=>String(r[key])===String(doc[key]))))throw Object.assign(Error('duplicate'),{code:11000});const item={version:0,lists:[],screens:[],transactions:[],...structuredClone(doc),_id:doc._id||String(++id)};records.push(item);return structuredClone(item);},
  find:q=>query(()=>records.filter(r=>match(r,q)),true),findOne:q=>query(()=>records.find(r=>match(r,q))||null),findById:id=>query(()=>records.find(r=>String(r._id)===String(id))||null),
  findOneAndUpdate(q,ops,options={}){return query(()=>{let doc=records.find(r=>match(r,q));if(!doc&&options.upsert){if(records.some(r=>r._id===q._id))throw Object.assign(Error('lease'),{code:11000});doc={_id:q._id};records.push(doc);}return doc?apply(doc,ops):null;});},
  updateOne(q,ops){const doc=records.find(r=>match(r,q));if(doc)apply(doc,ops);return Promise.resolve({matchedCount:doc?1:0});}
 };
}
module.exports={memoryModel,match};
