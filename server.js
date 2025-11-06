const express = require('express');
const TelegramBotHandler = require('./bot/TelegramBotHandler');
const { loadTemplate } = require('./utils/templateLoader');
const database = require('./config/database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize bot handler
const botHandler = new TelegramBotHandler();

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        bot: botHandler.isInitialized ? 'Initialized' : 'Not Initialized',
        database: database.getConnectionStatus() ? 'Connected' : 'Disconnected',
        service: 'Twitter Bot'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Twitter Bot API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            webhook: '/webhook',
            callback: '/auth/x/callback'
        }
    });
});

// Webhook endpoint for Telegram bot
app.post('/webhook', async (req, res) => {
    try {
        console.log('📨 Received webhook request:', JSON.stringify(req.body, null, 2));
        
        // Ensure bot is initialized (for cold starts on Vercel)
        if (!botHandler.isInitialized) {
            try {
                await botHandler.init();
            } catch (initError) {
                console.error('❌ Failed to initialize bot:', initError);
            }
        }
        
        // Handle the webhook update
        await botHandler.handleWebhookUpdate(req.body);
        
        // Always respond with 200 OK to Telegram
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('❌ Error handling webhook:', error);
        // Still respond with 200 to avoid Telegram retrying
        res.status(200).json({ status: 'Error but OK' });
    }
});

// OAuth callback endpoint
app.get('/auth/x/callback', async (req, res) => {
    const { code, state } = req.query;
    
    console.log('🔗 OAuth Callback Received:');
    console.log('  Code:', code);
    console.log('  State:', state);
    
    if (!code || !state) {
        return res.status(400).send('Missing code or state parameter');
    }
    
    try {
        // Ensure bot is initialized
        if (!botHandler.isInitialized) {
            await botHandler.init();
        }
        
        const actualCallbackUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        console.log('📱 Displaying callback URL to user:', actualCallbackUrl);
        res.send(loadTemplate('authSuccess', { CALLBACK_URL: actualCallbackUrl }));
    } catch (error) {
        console.error('❌ Error handling OAuth callback:', error);
        res.status(500).send('Internal server error');
    }
});

// Serve static files (for the logo)
app.get('/wengroLogo.jpg', (req, res) => {
    res.sendFile(__dirname + '/wengroLogo.jpg');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send(loadTemplate('404', { REQUESTED_PATH: req.originalUrl }));
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await botHandler.stop();
    await database.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    await botHandler.stop();
    await database.disconnect();
    process.exit(0);
});

// Initialize and start server (for local development)
async function startServer() {
    try {
        // Connect to database
        await database.connect();
        console.log('✅ Database connected');
        
        // Initialize Telegram bot
        await botHandler.init();
        console.log('✅ Bot initialized');
        
        // Start Express server (only for local development)
        if (process.env.NODE_ENV !== 'production') {
            app.listen(PORT, () => {
                console.log(`🚀 Server running on port ${PORT}`);
                console.log(`📊 Health check: http://localhost:${PORT}/health`);
                console.log(`🤖 Telegram bot is running`);
                console.log(`🔗 Callback URL: http://localhost:${PORT}/auth/x/callback`);
            });
        }
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        // Don't exit in production (Vercel) - let it handle cold starts
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        }
    }
}

// Start the server (for local) or export for Vercel
if (process.env.NODE_ENV !== 'production') {
    startServer();
}

// Export the app for Vercel
module.exports = app;
