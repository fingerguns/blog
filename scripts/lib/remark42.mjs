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
        function remarkColors(theme){
          if(theme==="dark"){
            return{"--primary-background-color":"13, 13, 13","--primary-text-color":"232, 232, 232","--secondary-text-color":"136, 136, 136","--white-color":"13, 13, 13","--color4":"#0d0d0d","--color5":"#0d0d0d","--color6":"#0d0d0d","--color19":"#0d0d0d","--color21":"#0d0d0d","--color22":"#0d0d0d","--line-color":"#2e2e2e"};
          }
          return{"--primary-background-color":"245, 240, 232","--primary-text-color":"26, 26, 26","--secondary-text-color":"118, 118, 118","--white-color":"245, 240, 232","--color4":"#f5f0e8","--color5":"#f5f0e8","--color6":"#f5f0e8","--color19":"#f5f0e8","--color21":"#f5f0e8","--color22":"#f5f0e8","--line-color":"#d5cfc4"};
        }
        function siteTheme(){
          var t=document.documentElement.getAttribute("data-theme");
          if(t==="dark"||t==="light") return t;
          try{return localStorage.getItem("theme")==="dark"?"dark":"light";}catch(e){return "light";}
        }
        window.__remarkColors=remarkColors;
        var t=siteTheme();
        remark_config.theme=t;
        remark_config.__colors__=remarkColors(t);
      }());
    </script>
    <script>!function(e,n){for(var o=0;o<e.length;o++){var r=n.createElement("script"),c=".js",d=n.head||n.body;"noModule"in r?(r.type="module",c=".mjs"):r.async=!0,r.defer=!0,r.src=remark_config.host+"/web/"+e[o]+c,d.appendChild(r)}}(remark_config.components||["embed"],document);</script>
    <script>(function(){
      function siteTheme(){
        var t=document.documentElement.getAttribute("data-theme");
        if(t==="dark"||t==="light") return t;
        try{return localStorage.getItem("theme")==="dark"?"dark":"light";}catch(e){return "light";}
      }
      function applyRemarkTheme(){
        var t=siteTheme();
        if(window.remark_config){
          window.remark_config.theme=t;
          if(window.__remarkColors) window.remark_config.__colors__=window.__remarkColors(t);
        }
        if(!window.REMARK42) return;
        if(window.__r42Theme===undefined){
          window.__r42Theme=t;
          if(window.REMARK42.changeTheme) window.REMARK42.changeTheme(t);
          return;
        }
        if(window.__r42Theme===t) return;
        window.__r42Theme=t;
        if(window.REMARK42.destroy) window.REMARK42.destroy();
        var root=document.getElementById("remark42");
        if(root) root.textContent="Loading comments…";
        if(window.REMARK42.createInstance) window.REMARK42.createInstance(window.remark_config);
      }
      var btn=document.getElementById("theme-toggle");
      if(btn) btn.addEventListener("click",function(){ setTimeout(applyRemarkTheme,0); });
      if(window.MutationObserver){
        new MutationObserver(applyRemarkTheme).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
      }
      var tries=0;
      var iv=setInterval(function(){
        applyRemarkTheme();
        if(window.__r42Theme!==undefined||++tries>40) clearInterval(iv);
      },250);
    }());</script>`;
}
