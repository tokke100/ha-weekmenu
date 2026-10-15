FROM node:22-alpine

WORKDIR /app
COPY app/ /app/

# /data is de persistente map van de add-on (zit ook in HA-back-ups)
ENV WEEKMENU_DATA=/data
EXPOSE 8099

CMD ["node", "/app/weekmenu.js", "--server", "--host", "0.0.0.0", "--poort", "8099"]
