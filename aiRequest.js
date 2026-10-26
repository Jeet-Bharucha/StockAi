'use strict';
function validateAIRequest(input){
 const {symbol,price,prediction:p}=input||{};const finite=n=>typeof n==='number'&&Number.isFinite(n);
 if(typeof symbol!=='string'||!/^[A-Z0-9^][A-Z0-9.\-^:=]{0,23}$/.test(symbol)||!finite(price)||price<=0||price>1e9||!p||typeof p!=='object'||!['UP','DOWN','NEUTRAL'].includes(p.direction)||!finite(p.confidence)||p.confidence<0||p.confidence>100||!Array.isArray(p.signals)||p.signals.length>30||!Array.isArray(p.patterns||[])||(p.patterns||[]).length>15)throw Error('Invalid or oversized indicator request');
 for(const s of p.signals)if(!s||typeof s.name!=='string'||s.name.length>100||typeof s.value!=='string'||s.value.length>100||typeof s.signal!=='string'||s.signal.length>40||!finite(s.score)||Math.abs(s.score)>100)throw Error('Invalid indicator signal');
 for(const row of p.patterns||[])if(!row||typeof row.name!=='string'||row.name.length>100)throw Error('Invalid indicator pattern');
 for(const key of ['support','resistance','atrPct','buyCount','sellCount','neutralCount'])if(p[key]!=null&&(!finite(p[key])||p[key]<0||p[key]>1e12))throw Error('Invalid indicator value');
 return {symbol,price,prediction:p};
}
module.exports={validateAIRequest};
