FROM oven/bun:latest as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --production

# Copy source code
COPY . .

# Expose the port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV production

# Run the application
CMD ["bun", "index.ts"] 