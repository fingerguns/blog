FROM umputun/remark42:latest

USER root
RUN cp /srv/web/remark.css /srv/web/remark-base.css
COPY remark-overrides.css /srv/web/remark-overrides.css
RUN printf '@import url("remark-base.css");\n' > /srv/web/remark.css \
  && cat /srv/web/remark-overrides.css >> /srv/web/remark.css \
  && CSS_VER=$(md5sum /srv/web/remark-overrides.css | cut -c1-8) \
  && sed -i "s|href=\"remark.css\"|href=\"remark.css?v=${CSS_VER}\"|" /srv/web/iframe.html
