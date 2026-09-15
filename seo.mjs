const BASE='https://inboxproof.email';
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function attribute(tag,name){return tag.match(new RegExp('\\b'+name+'\\s*=\\s*(["\'])(.*?)\\1','i'))?.[2]||'';}
function metaValue(html,key){const tag=(html.match(/<meta\b[^>]*>/gi)||[]).find(t=>attribute(t,'property')===key||attribute(t,'name')===key);return tag?attribute(tag,'content'):'';}
export function publicMetadata(html,pathname){
 const route=pathname==='/index.html'?'/':pathname.replace(/\.html$/,'');
 const canonical=BASE+route;
 // Keep the page's wording and body intact. Emit each discovery field once.
 const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'Inboxproof').trim();
 const description=metaValue(html,'description');
 const fields={'og:title':metaValue(html,'og:title')||title,'og:description':metaValue(html,'og:description')||description,'og:type':metaValue(html,'og:type')||(route.startsWith('/blog/')?'article':'website'),'og:site_name':'Inboxproof','og:url':canonical,'og:image':BASE+'/og.png','og:image:width':'1200','og:image:height':'630','og:image:alt':'Inboxproof: email configuration checks and daily domain monitoring','twitter:card':'summary_large_image','twitter:title':metaValue(html,'twitter:title')||title,'twitter:description':metaValue(html,'twitter:description')||description,'twitter:image':BASE+'/og.png'};
 html=html.replace(/<link\b[^>]*>/gi,tag=>attribute(tag,'rel').toLowerCase()==='canonical'?'':tag);
 html=html.replace(/<meta\b[^>]*>/gi,tag=>Object.hasOwn(fields,attribute(tag,'property')||attribute(tag,'name'))?'':tag);
 // Existing HTML attributes already contain entities; normalize only when read back.
 const decode=v=>v.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 const tags='<link rel="canonical" href="'+escape(canonical)+'">\n'+Object.entries(fields).filter(([,v])=>v).map(([key,value])=>'<meta '+(key.startsWith('og:')?'property':'name')+'="'+key+'" content="'+escape(decode(value))+'">').join('\n');
 return html.replace(/<\/head>/i,tags+'\n</head>');
}
