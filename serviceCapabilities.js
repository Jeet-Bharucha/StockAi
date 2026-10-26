'use strict';
function capabilities(env=process.env){
 const sender=String(env.RESEND_FROM_EMAIL||'').trim();const testSender=/(?:@resend\.dev[>\s]*$)/i.test(sender);let siteUrlReady=false;try{const url=new URL(env.SITE_URL);siteUrlReady=url.protocol==='https:'&&url.origin===env.SITE_URL.replace(/\/$/,'');}catch(_){}
 return {checkedAt:new Date().toISOString(),aiCommentary:env.ANTHROPIC_API_KEY?'configured':'not-configured',localChartAssistant:'available',email:{settingsPresent:Boolean(env.RESEND_API_KEY&&sender),senderMode:!sender?'missing':testSender?'owner-test-only':'domain-verification-required',backgroundWorkerEnabled:env.BACKGROUND_ALERTS_ENABLED==='true',deliveryVerified:false},passwordRecoverySettingsPresent:Boolean(env.RESEND_API_KEY&&sender&&siteUrlReady),accessMode:env.PUBLIC_SITE_ENABLED==='true'?'public':'private',note:'Configuration presence does not prove provider access, sender verification, worker heartbeat or inbox delivery.'};
}
module.exports={capabilities};
