# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---- dev (hot reload) ----
FROM deps AS dev
COPY . .
EXPOSE 4321
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- export static files: docker build --target export --output dist . ----
FROM scratch AS export
COPY --from=build /app/dist /

# ---- preview production build ----
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
