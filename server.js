const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const activeCalls = new Map();

console.log('🚀 Tommy Voice Server starting...');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/llm-websocket' });

const SYSTEM_PROMPT = `You are Tommy, an AI assistant created by Andrew. Your name is Tommy.

About Andrew:
- His name is Andrew Marshina
- Phone: 856-449-6140
- He's in New Jersey, USA
- He's a high school student

Your personality:
- Be helpful, friendly, and conversational
- Answer questions directly and honestly
- Keep responses natural and not too long
- If you don't know something, say so

When someone calls:
- Introduce yourself as Tommy, Andrew's AI assistant
- Be polite and professional
- Help them with whatever they need

IMPORTANT: When calling businesses (restaurants, etc.), follow Andrew's instructions. If he didn't give specific instructions, just make small talk and say Andrew will call back.`;

async function generateResponse(transcript) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];
    if (transcript && transcript.length > 0) {
        transcript.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });
    }
    
    if (!OPENROUTER_API_KEY) {
        console.log('⚠️ No OPENROUTER_API_KEY set, using fallback');
        const lastMsg = transcript && transcript.length > 0 ? transcript[transcript.length - 1].content : "";
        if (lastMsg.toLowerCase().includes('hello') || lastMsg.toLowerCase().includes('hi')) {
            return "Hello! This is Tommy, Andrew's AI assistant. How can I help you today?";
        }
        return "I'm here to help. What would you like to talk about?";
    }
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tommy-voice-server.onrender.com',
                'X-Title': 'Tommy Voice Server'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: messages,
                max_tokens: 150
            })
        });
        
        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        }
        
        return "I'm here to help. What would you like to talk about?";
    } catch (error) {
        console.error('API error:', error);
        return "I'm having trouble thinking right now. What can I help you with?";
    }
}

wss.on('connection', (ws, req) => {
    console.log('🔌 New WebSocket connection from Retell');
    
    const urlParts = req.url.split('/');
    const callId = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
    console.log(`📞 Call ID: ${callId}`);
    
    activeCalls.set(callId, { ws, transcript: [] });
    
    // Send config
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { auto_reconnect: false, call_details: false, transcript_with_tool_calls: false }
    }));
    console.log('📤 Sent config');
    
    // Send greeting
    ws.send(JSON.stringify({
        response_type: 'response',
        response_id: 1,
        content: "Hello, this is Tommy, Andrew's AI assistant. How can I help you today?",
        content_complete: true
    }));
    console.log('📤 Sent greeting');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Interaction:', data.interaction_type);
            
            switch (data.interaction_type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ response_type: 'ping_pong', timestamp: Date.now() }));
                    break;
                    
                case 'update_only':
                    if (data.transcript && data.transcript.length > 0) {
                        const callData = activeCalls.get(callId);
                        if (callData) callData.transcript = data.transcript;
                        const latest = data.transcript[data.transcript.length - 1];
                        console.log(`🗣️ ${latest.role}: ${latest.content}`);
                    }
                    break;
                    
                case 'response_required':
                    console.log('🎯 Generating AI response...');
                    const callData = activeCalls.get(callId);
                    if (callData) {
                        const responseText = await generateResponse(callData.transcript);
                        ws.send(JSON.stringify({
                            response_type: 'response',
                            response_id: data.response_id,
                            content: responseText,
                            content_complete: true
                        }));
                        console.log(`📤 AI: ${responseText}`);
                    }
                    break;
                    
                case 'reminder_required':
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: "Is there anything else I can help you with?",
                        content_complete: true
                    }));
                    break;
            }
        } catch (err) {
            console.error('Error:', err);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket closed');
        activeCalls.delete(callId);
    });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    const event = req.body;
    console.log('📥 Webhook:', event.event || event.type);
    res.status(204).send();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', connections: activeCalls.size, timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        name: 'Tommy Voice Server',
        status: 'running',
        endpoints: {
            websocket: '/llm-websocket',
            webhook: '/webhook',
            health: '/health'
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: wss://tommy-voice-server.onrender.com/llm-websocket`);
    console.log(`📡 Webhook endpoint: https://tommy-voice-server.onrender.com/webhook`);
});