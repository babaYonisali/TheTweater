# Vercel Deployment Checklist

## Pre-Deployment Setup

### 1. Environment Variables
Make sure you have all required environment variables ready:

- [ ] `MONGODB_URI` - MongoDB connection string (use MongoDB Atlas for production)
- [ ] `TELEGRAM_BOT_TOKEN` - Get from @BotFather on Telegram
- [ ] `X_CLIENT_ID` - Twitter Developer Portal app client ID
- [ ] `X_CLIENT_SECRET` - Twitter Developer Portal app client secret
- [ ] `X_CALLBACK_URL` - Will be `https://your-app.vercel.app/auth/x/callback`
- [ ] `OPENAI_API_KEY` - OpenAI API key (for DeepSeek integration)
- [ ] `DEEPSEEK_API_KEY` - DeepSeek API key
- [ ] `NODE_ENV` - Set to `production`

### 2. Twitter App Configuration
- [ ] Create Twitter app in Developer Portal
- [ ] Enable OAuth 2.0
- [ ] Set callback URL to your Vercel domain
- [ ] Note down Client ID and Client Secret

### 3. Telegram Bot Setup
- [ ] Create bot with @BotFather
- [ ] Get bot token
- [ ] Configure bot commands (optional)

## Deployment Steps

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```

### 3. Deploy
```bash
vercel
```

### 4. Set Environment Variables
In Vercel dashboard:
1. Go to your project
2. Settings → Environment Variables
3. Add all required variables
4. Set `NODE_ENV` to `production`

### 5. Update Twitter Callback URL
1. Get your Vercel app URL
2. Update Twitter app callback URL to: `https://your-app.vercel.app/auth/x/callback`

### 6. Production Deploy
```bash
vercel --prod
```

## Post-Deployment Testing

- [ ] Test `/start` command
- [ ] Test `/connect` command
- [ ] Test OAuth flow
- [ ] Test `/post` command
- [ ] Test AI chat functionality
- [ ] Check health endpoint: `https://your-app.vercel.app/health`

## Troubleshooting

### Common Issues:
1. **Environment variables not set** - Check Vercel dashboard
2. **MongoDB connection failed** - Ensure MongoDB Atlas allows Vercel IPs
3. **Twitter OAuth fails** - Check callback URL matches exactly
4. **Bot not responding** - Check Telegram bot token
5. **AI not working** - Verify DeepSeek API key

### Logs:
Check Vercel function logs in the dashboard for debugging.

## Performance Considerations

- Consider switching to webhook mode for better performance
- Monitor function execution time (30s limit)
- Use MongoDB Atlas for reliable database hosting
- Consider implementing rate limiting for production use
