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
          try { return localStorage.getItem("theme")==="dark"?"dark":"light"; } catch(e) { return "light"; }
        }
        remark_config.theme=siteTheme();
      }());
    </script>
    <script>!function(e,n){for(var o=0;o<e.length;o++){var r=n.createElement("script"),c=".js",d=n.head||n.body;"noModule"in r?(r.type="module",c=".mjs"):r.async=!0,r.defer=!0,r.src=remark_config.host+"/web/"+e[o]+c,d.appendChild(r)}}(remark_config.components||["embed"],document);</script>
    <script>(function(){
      function siteTheme(){
        var t=document.documentElement.getAttribute("data-theme");
        if(t==="dark"||t==="light") return t;
        try { return localStorage.getItem("theme")==="dark"?"dark":"light"; } catch(e) { return "light"; }
      }
      function syncRemarkTheme(){
        var t=siteTheme();
        if(window.remark_config) window.remark_config.theme=t;
        if(!window.REMARK42) return;
        if(window.__remark42LoadedTheme===undefined){
          window.__remark42LoadedTheme=t;
          if(window.REMARK42.changeTheme) window.REMARK42.changeTheme(t);
          return;
        }
        if(window.__remark42LoadedTheme!==t){
          window.__remark42LoadedTheme=t;
          if(window.REMARK42.destroy) window.REMARK42.destroy();
          var root=document.getElementById("remark42");
          if(root) root.textContent="Loading comments…";
          if(window.REMARK42.createInstance) window.REMARK42.createInstance(window.remark_config);
          return;
        }
        if(window.REMARK42.changeTheme) window.REMARK42.changeTheme(t);
      }
      if(window.MutationObserver){
        new MutationObserver(syncRemarkTheme).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
      }
      var tries=0;
      var iv=setInterval(function(){
        syncRemarkTheme();
        if(window.__remark42LoadedTheme!==undefined||++tries>40) clearInterval(iv);
      },250);
    }());</script>`;
}
