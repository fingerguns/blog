/** Remark42 embed for Writing post pages. Enabled unless REMARK42_DISABLED is set. */

const DEFAULT_REMARK42_HOST = "https://comments.rommy.blog";
const DEFAULT_REMARK42_SITE_ID = "rommy.blog";

export function remark42Configured() {
  if (String(process.env.REMARK42_DISABLED || "").trim() === "1") return null;
  const host = String(process.env.REMARK42_HOST || DEFAULT_REMARK42_HOST).trim().replace(/\/$/, "");
  const siteId = String(process.env.REMARK42_SITE_ID || DEFAULT_REMARK42_SITE_ID).trim();
  if (!host) return null;
  return { host, siteId };
}

export function remark42EmbedHtml({ pageUrl, pageTitle }) {
  const cfg = remark42Configured();
  if (!cfg) return "";

  const configJson = JSON.stringify({
    host: cfg.host,
    site_id: cfg.siteId,
    components: ["embed"],
    url: pageUrl,
    page_title: pageTitle,
    locale: "en",
    theme: "light",
    no_footer: true,
    show_email_subscription: false,
    show_rss_subscription: false,
  });

  return `      <section class="post-comments" aria-labelledby="comments-heading">
        <h2 id="comments-heading">Comments</h2>
        <div id="remark42">Loading comments…</div>
      </section>
    <script>
      var remark_config = ${configJson};
      (function(){
        function siteTheme(){
          var t=document.documentElement.getAttribute("data-theme");
          if(t==="dark"||t==="light") return t;
          try{return localStorage.getItem("theme")==="dark"?"dark":"light";}catch(e){return "light";}
        }
        remark_config.theme=siteTheme();
      }());
    </script>
    <script>!function(e,n){for(var o=0;o<e.length;o++){var r=n.createElement("script"),c=".js",d=n.head||n.body;"noModule"in r?(r.type="module",c=".mjs"):r.async=!0,r.defer=!0,r.src=remark_config.host+"/web/"+e[o]+c,d.appendChild(r)}}(remark_config.components||["embed"],document);</script>
    <script>(function(){
      function siteTheme(){
        var t=document.documentElement.getAttribute("data-theme");
        if(t==="dark"||t==="light") return t;
        try{return localStorage.getItem("theme")==="dark"?"dark":"light";}catch(e){return "light";}
      }
      function bootRemark42(recreate){
        if(!window.remark_config) return false;
        window.remark_config.theme=siteTheme();
        if(!window.REMARK42||!window.REMARK42.createInstance) return false;
        if(recreate&&window.REMARK42.destroy){
          window.REMARK42.destroy();
          var root=document.getElementById("remark42");
          if(root) root.textContent="Loading comments…";
        }
        window.REMARK42.createInstance(window.remark_config);
        window.__r42Theme=window.remark_config.theme;
        return true;
      }
      function onThemeChange(){
        if(!window.REMARK42) return;
        var t=siteTheme();
        if(window.__r42Theme===t) return;
        bootRemark42(true);
      }
      var btn=document.getElementById("theme-toggle");
      if(btn) btn.addEventListener("click",function(){ setTimeout(onThemeChange,0); });
      if(window.MutationObserver){
        new MutationObserver(onThemeChange).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
      }
      var tries=0;
      var iv=setInterval(function(){
        if(window.REMARK42&&window.REMARK42.createInstance){
          if(!window.__r42Booted){
            window.__r42Booted=true;
            bootRemark42(true);
          } else {
            onThemeChange();
          }
          clearInterval(iv);
        }
        if(++tries>40) clearInterval(iv);
      },250);
    }());</script>`;
}
