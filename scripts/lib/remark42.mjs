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
      try {
        remark_config.theme = localStorage.getItem("theme") === "dark" ? "dark" : "light";
      } catch (e) {}
    </script>
    <script>!function(e,n){for(var o=0;o<e.length;o++){var r=n.createElement("script"),c=".js",d=n.head||n.body;"noModule"in r?(r.type="module",c=".mjs"):r.async=!0,r.defer=!0,r.src=remark_config.host+"/web/"+e[o]+c,d.appendChild(r)}}(remark_config.components||["embed"],document);</script>
    <script>(function(){
      function syncRemarkTheme(){
        if(!window.REMARK42||!window.REMARK42.changeTheme)return;
        var t=document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light";
        window.REMARK42.changeTheme(t);
      }
      var btn=document.getElementById("theme-toggle");
      if(btn) btn.addEventListener("click",function(){ setTimeout(syncRemarkTheme,0); });
      var tries=0;
      var iv=setInterval(function(){
        syncRemarkTheme();
        if(window.REMARK42&&window.REMARK42.changeTheme||++tries>40) clearInterval(iv);
      },250);
    }());</script>`;
}
