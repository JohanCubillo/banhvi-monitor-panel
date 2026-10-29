(function (scope) {
  'use strict';
  const PUBLISHED_URL='https://johancubillo.github.io/banhvi-monitor-panel/';
  const allowedQuery=['admin','cliente','activar','empresa','code','token_hash','type','error','error_code','error_description'];
  const allowedHash=['access_token','refresh_token','expires_at','expires_in','token_type','type','error','error_code','error_description'];
  function publishedUrl(where=scope.location){
    const target=new URL(PUBLISHED_URL),source=new URLSearchParams(where?.search||'');
    for(const key of allowedQuery)if(source.has(key))target.searchParams.set(key,source.get(key));
    const hash=new URLSearchParams(String(where?.hash||'').replace(/^#/,'')),filtered=new URLSearchParams();
    for(const key of allowedHash)if(hash.has(key))filtered.set(key,hash.get(key));
    target.hash=filtered.toString();return target.href;
  }
  function redirectUrl(where=scope.location,{admin=true,activate=false,organizationSlug,clientSlug}={}){
    const base=where?.protocol==='http:'||where?.protocol==='https:'?`${where.origin}${where.pathname}`:PUBLISHED_URL;
    const target=new URL(base);
    if(clientSlug!==undefined)target.searchParams.set('cliente',clientSlug);
    else if(admin)target.searchParams.set('admin','1');
    if(activate)target.searchParams.set('activar','1');
    if(organizationSlug)target.searchParams.set('empresa',organizationSlug);
    return target.href;
  }
  function activationContext(where=scope.location){
    const query=new URLSearchParams(where?.search||''),hash=new URLSearchParams(String(where?.hash||'').replace(/^#/,''));
    const requested=query.get('activar')==='1';
    const hasError=['error','error_code','error_description'].some(key=>query.has(key)||hash.has(key));
    const verifiedCallback=requested&&!hasError&&!!hash.get('access_token')&&!!hash.get('refresh_token')&&['signup','magiclink','invite'].includes(hash.get('type'));
    return {requested,verifiedCallback};
  }
  function describeError(error={}, {action='email'}={}){
    const code=String(error.code||error.error_code||'').toLowerCase(),status=Number(error.status);
    if(status===429||['over_email_send_rate_limit','over_request_rate_limit','email_rate_limit_exceeded'].includes(code))return 'Se alcanzó el límite temporal de solicitudes de correo. Esperá unos minutos antes de intentarlo nuevamente.';
    if(['email_address_not_authorized','email_provider_disabled'].includes(code))return 'El proveedor de correo del proyecto no permite enviar a este destinatario. El administrador debe revisar la configuración de envío de Supabase.';
    if(['signup_disabled','otp_disabled','signups_not_allowed'].includes(code))return 'El proyecto no permite este método de activación. El administrador debe revisar la configuración de acceso de Supabase.';
    if(['email_address_invalid','validation_failed'].includes(code))return 'Revisá el formato del correo e intentá nuevamente.';
    if(['user_not_found','invalid_credentials','email_not_confirmed'].includes(code))return 'No se pudo completar el acceso. Si es tu primer ingreso, usá “Activar acceso por primera vez”; si ya tenés cuenta, podés recuperar la contraseña.';
    if(['redirect_url_not_allowed','bad_redirect_url','invalid_redirect_url'].includes(code))return 'La dirección de regreso no está autorizada en Supabase. Abrí BonoAlerta desde GitHub Pages y revisá las URL de acceso del proyecto.';
    if(['unexpected_failure','smtp_error'].includes(code)||status>=500)return action==='password'?'El servicio de acceso no pudo procesar la solicitud. Intentá nuevamente más tarde.':'El servicio de correo no pudo procesar la solicitud. El administrador debe revisar los registros de Auth y el proveedor de correo.';
    if(error.name==='AuthRetryableFetchError'||error.name==='TypeError'||status===0&&/fetch|network|connection/i.test(String(error.message||'')))return 'No se pudo conectar con el servicio de acceso. Revisá la conexión e intentá nuevamente.';
    return action==='password'?'No se pudo completar el ingreso. Intentá nuevamente y, si continúa, consultá los registros de Auth del proyecto.':'No se pudo enviar el correo de acceso. Revisá el correo, usá la versión publicada y, si continúa, consultá los registros de Auth del proyecto.';
  }
  function bootstrap(where=scope.location,doc=scope.document){
    if(where?.protocol!=='file:')return false;
    const target=publishedUrl(where);
    if(doc?.addEventListener)doc.addEventListener('DOMContentLoaded',()=>{
      const message=doc.createElement('main'),title=doc.createElement('h1'),text=doc.createElement('p'),link=doc.createElement('a');
      message.style.cssText='max-width:620px;margin:12vh auto;padding:28px;font:16px/1.6 sans-serif';title.textContent='Abrir BonoAlerta en línea';text.textContent='Los accesos y los enlaces de correo funcionan desde la versión publicada.';link.href=target;link.textContent='Continuar en GitHub Pages';message.append(title,text,link);doc.body.replaceChildren(message);
    },{once:true});
    where.replace(target);return true;
  }
  scope.BonoAuth={PUBLISHED_URL,publishedUrl,redirectUrl,activationContext,describeError,bootstrap};
  bootstrap();
})(globalThis);
