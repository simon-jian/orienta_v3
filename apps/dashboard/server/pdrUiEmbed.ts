/**
 * Embed pedestrian_dead_reckoning's full frontend (index.html / pdr.html / js/*)
 * under `/pdr-ui` on the dashboard origin (phone via trycloudflare).
 *
 * PDR pages call absolute `/api/...` and `/ws/...`, which on this origin belong
 * to the dashboard, so we inject a small rewrite pointing them at `/pdr-api`
 * instead, and rewrite `/api/config` map URLs to the same-origin indoor-map
 * proxy. Authentication for the position push is the page's own job — its
 * orienta bridge reads `?sessionToken` and sends the bearer header itself.
 */
export function injectPdrUiEmbedBridge(htmlUtf8: string): string {
  if (htmlUtf8.includes("orienta-pdr-ui-embed-bridge")) return htmlUtf8;
  const inject = `<script>/*orienta-pdr-ui-embed-bridge*/(function(){
try{
  var API_PREFIX='/pdr-api';
  var ofetch=window.fetch;
  window.fetch=function(input, init){
    function rewrite(u){
      if(typeof u!=='string') return u;
      if(u.charAt(0)==='/' && (u.indexOf('/api/')===0 || u==='/api' || u.indexOf('/api?')===0)) return API_PREFIX+u;
      return u;
    }
    var url=typeof input==='string'?input:(input && input.url)||'';
    var next=rewrite(url);
    if(typeof input==='string') input=next;
    else if(next!==url && typeof Request!=='undefined' && input instanceof Request) input=new Request(next, input);
    var p=ofetch(input, init);
    if(typeof next==='string' && (next.indexOf(API_PREFIX+'/api/config')>=0 || next.endsWith('/api/config'))){
      return p.then(function(res){
        if(!res || !res.ok) return res;
        return res.json().then(function(data){
          data=data||{};
          data.airport_map_url=location.origin+'/indoor-map/airport-map.html';
          data.airport_map_api_base=location.origin+'/indoor-map-api';
          return new Response(JSON.stringify(data), {status:200, headers:{'content-type':'application/json'}});
        }).catch(function(){ return res; });
      });
    }
    return p;
  };
  var OWS=window.WebSocket;
  window.WebSocket=function(url, protocols){
    if(typeof url==='string'){
      if(url.charAt(0)==='/' && url.indexOf('/ws/')===0) url=API_PREFIX+url;
      else if(url.indexOf('://')>=0){
        try{
          var u=new URL(url);
          if(u.pathname.indexOf('/ws/')===0 && u.pathname.indexOf('/pdr-api/')<0){
            u.pathname='/pdr-api'+u.pathname;
            url=u.toString();
          }
        }catch(e){}
      }
    }
    return protocols!==undefined ? new OWS(url, protocols) : new OWS(url);
  };
  window.WebSocket.prototype=OWS.prototype;
}catch(e){}
})();<\/script>`;
  if (/<head[^>]*>/i.test(htmlUtf8)) {
    return htmlUtf8.replace(/<head[^>]*>/i, (m) => `${m}${inject}`);
  }
  return inject + htmlUtf8;
}
