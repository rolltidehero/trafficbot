FROM alpine:3.22
RUN apk add --no-cache tor && mkdir -p /var/lib/tor && chown tor:tor /var/lib/tor
COPY docker/tor/torrc /etc/tor/torrc
USER tor
ENTRYPOINT ["tor", "-f", "/etc/tor/torrc"]
