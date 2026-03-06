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

// WebSocket server - handle path with call_id parameter
const wss = new WebSocket.Server({ server });

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
- Help them with whatever they need`;

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
    // Parse call_id from URL path: /llm-websocket/{call_id}
    const urlPath = req.url;
    console.log('🔌 WebSocket connection request:', urlPath);
    
    // Extract call_id from path
    const pathParts = urlPath.split('/').filter(p => p);
    let callId = pathParts[pathParts.length - 1];
    
    // If path doesn't include llm-websocket, it might just be the call_id
    if (!urlPath.includes('llm-websocket')) {
        callId = pathParts[0];
    }
    
    // If callId is empty or 'llm-websocket', generate a temporary one
    if (!callId || callId === 'llm-websocket') {
        callId = 'call-' + Date.now();
    }
    
    console.log(`📞 Call ID: ${callId}`);
    
    activeCalls.set(callId, { ws, transcript: [] });
    
    // Send config event (required by Retell protocol)
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { 
            auto_reconnect: true, 
            call_details: true, 
            transcript_with_tool_calls: false 
        }
    }));
    console.log('📤 Sent config');
    
    // IMPORTANT: Do NOT send greeting here! 
    // Only respond when Retell sends response_required event
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Received:', data.interaction_type || data.response_type);
            
            switch (data.interaction_type) {
                case 'ping_pong':
                    // Respond to keep-alive ping
                    ws.send(JSON.stringify({ 
                        response_type: 'ping_pong', 
                        timestamp: Date.now() 
                    }));
                    console.log('📤 Sent ping_pong');
                    break;
                    
                case 'call_details':
                    // Retell sends call details after config with call_details: true
                    console.log('📞 Call details:', JSON.stringify(data.call, null, 2));
                    break;
                    
                case 'update_only':
                    // Transcript update - store it but don't respond
                    if (data.transcript && data.transcript.length > 0) {
                        const callData = activeCalls.get(callId);
                        if (callData) {
                            callData.transcript = data.transcript;
                        }
                        const latest = data.transcript[data.transcript.length - 1];
                        console.log(`🗣️ ${latest.role}: ${latest.content}`);
                    }
                    break;
                    
                case 'response_required':
                    // Retell is asking for a response
                    console.log('🎯 Response required, response_id:', data.response_id);
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
                    } else {
                        // No transcript yet, send a greeting
                        ws.send(JSON.stringify({
                            response_type: 'response',
                            response_id: data.response_id,
                            content: "Hello, this is Tommy, Andrew's AI assistant. How can I help you today?",
                            content_complete: true
                        }));
                    }
                    break;
                    
                case 'reminder_required':
                    // User has been silent, send a reminder
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: "Are you still there? How can I help you?",
                        content_complete: true
                    }));
                    break;
            }
        } catch (err) {
            console.error('❌ Error processing message:', err);
            console.error('Raw message:', message.toString());
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket closed for call:', callId);
        activeCalls.delete(callId);
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err);
    });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    const event = req.body;
    console.log('📥 Webhook:', event.event || event.type, JSON.stringify(event, null, 2));
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
        connections: activeCalls.size,
        endpoints: {
            websocket: '/llm-websocket/{call_id}',
            webhook: '/webhook',
            health: '/health'
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: wss://tommy-voice-server.onrender.com/llm-websocket/{call_id}`);
    console.log(`📡 Webhook endpoint: https://tommy-voice-server.onrender.com/webhook`);
});