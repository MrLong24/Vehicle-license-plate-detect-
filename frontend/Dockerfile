# Sử dụng Node.js để build
FROM node:18-alpine

WORKDIR /app

# Cài đặt dependencies
COPY package*.json ./
RUN npm install

# Copy code và build
COPY . .
RUN npm run build

# Sử dụng serve để chạy production hoặc chạy trực tiếp npm start nếu đang dev
RUN npm install -g serve
EXPOSE 3000

CMD ["npm", "start"]