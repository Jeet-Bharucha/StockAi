'use strict';
function senderDomain(sender){const value=String(sender||'').trim();const address=value.match(/<([^<>]+)>$/)?.[1]||value;const match=address.match(/^[^\s<>@]+@([a-z0-9.-]+\.[a-z]{2,})$/i);return match?.[1].toLowerCase()||null;}
async function emailReadiness({key='',sender='',fetchImpl=fetch}){
 const domain=senderDomain(sender);const missing=[];if(!key)missing.push('RESEND_API_KEY');if(!sender)missing.push('RESEND_FROM_EMAIL');
 if(missing.length)return {state:'missing-settings',missing,domain:null,note:'Email settings are incomplete. No provider verification has been performed.'};
 if(!domain)return {state:'invalid-sender',missing:[],domain:null,note:'The sender address is not valid.'};
 if(domain==='resend.dev')return {state:'owner-test-only',domain,missing:[],note:'Resend test sender selected: only the email address associated with the Resend account can receive messages. This does not verify the key or inbox delivery; use the owner-only email self-test.'};
 try{
  let after=null,matched=null;const deadline=AbortSignal.timeout(15000);
  for(let page=0;page<10;page++){
   const url=new URL('https://api.resend.com/domains');url.searchParams.set('limit','100');if(after)url.searchParams.set('after',after);
   const r=await fetchImpl(url,{headers:{Authorization:'Bearer '+key},signal:deadline});
   if(r.status===401)return {state:'key-rejected',domain,missing:[],note:'Resend rejected the configured key.'};
   if(r.status===403)return {state:'verification-unknown',domain,missing:[],note:'The key may be send-only. Domain status cannot be read with its current permissions.'};
   if(!r.ok)throw Error('unavailable');const d=await r.json();matched=d.data?.find(x=>String(x.name).toLowerCase()===domain);if(matched)break;
   if(!d.has_more||!d.data?.length)break;after=d.data.at(-1).id;
  }
  return {state:matched?.status==='verified'?'domain-verified':matched?'domain-pending':'domain-not-found',domain,missing:[],note:matched?.status==='verified'?'Sender domain is verified. This does not prove inbox delivery.':'Sender domain is not confirmed verified on this key. Check the Resend account and DNS records.'};
 }catch(_){return {state:'verification-unknown',domain,missing:[],note:'Provider verification is unavailable. Setting presence is not proof of sender readiness.'};}
}
function emailFailure(error){
 const status=Number(error?.statusCode||error?.status),message=String(error?.message||'').toLowerCase();
 let code='provider-unavailable',detail='The email provider is unavailable. Retry shortly and check its status.';
 if(status===401||/invalid api key|api key is invalid/.test(message)){code='key-rejected';detail='Resend rejected the API key. Replace RESEND_API_KEY in Render with a valid key.';}
 else if(status===429){code='rate-limited';detail='Resend rate limit reached. Wait before retrying.';}
 else if(/only send testing emails|only.*testing.*own email/.test(message)){code='owner-address-mismatch';detail='The Resend test sender can send only to the email address associated with the Resend account. Check that it matches your StockAI account address.';}
 else if(/domain.*not verified|verify.*domain/.test(message)){code='sender-not-verified';detail='Resend requires a verified sender domain for this address. Use the owner-test sender for your own Resend account inbox.';}
 else if(status===403){code='key-permissions';detail='Resend denied access. Check the key send permissions and its allowed domain.';}
 else if(status===400||status===422){code='request-rejected';detail='Resend rejected the sender or recipient settings. Check the owner account address and sender format.';}
 else if(error?.name==='TimeoutError'||error?.name==='AbortError'){code='provider-timeout';detail='The email provider timed out. Wait before retrying; the first request may still have been accepted.';}
 return {code,error:detail};
}
function installEmailDiagnostics(app,{authMW,ownerOnly,rateLimit,fetchImpl=fetch,env=process.env,sendTest}){
 const chain=[authMW,ownerOnly,rateLimit];
 app.get('/api/admin/email-readiness',...chain,async(_req,res)=>res.set('Cache-Control','no-store').json(await emailReadiness({key:env.RESEND_API_KEY,sender:env.RESEND_FROM_EMAIL,fetchImpl})));
 app.post('/api/admin/email-self-test',...chain,async(req,res)=>{
  if(!env.RESEND_API_KEY||!senderDomain(env.RESEND_FROM_EMAIL))return res.status(503).json({error:'Configure a valid sender and API key first.'});
  try{await sendTest(req.user.email);return res.json({state:'provider-accepted',message:'The provider accepted the test for your account address. Check your inbox and spam folder; acceptance is not inbox delivery.'});}
  catch(error){return res.status(502).json(emailFailure(error));}
 });
}
module.exports={emailReadiness,senderDomain,emailFailure,installEmailDiagnostics};
