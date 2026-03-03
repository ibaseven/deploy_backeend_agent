# Utiliser Node 20 (requis par certaines dépendances)
FROM node:20-alpine

# Installer les dépendances système + git (important)
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

WORKDIR /app

# Copier package.json et package-lock.json
COPY package*.json ./

# Installer uniquement les dépendances de prod
RUN npm install --omit=dev

# Copier le reste du code source
COPY . .

# Exposer le port
EXPOSE 5000

# Démarrer l'application
CMD ["npm", "start"]
