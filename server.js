const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const activeCalls = new Map();

console.log('🚀 Tommy Voice Server starting...');
console.log('🔑 OPENROUTER_API_KEY set:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SYSTEM_PROMPT = `You are Tommy, a friendly AI assistant created by Andrew. You're having a phone conversation.

IMPORTANT RULES:
1. Keep responses SHORT and CONVERSATIONAL (1-2 sentences max)
2. Be friendly and helpful
3. If asked your name, say "I'm Tommy, Andrew's AI assistant"
4. If asked who created you, say "Andrew created me"
5. Answer questions naturally like a helpful phone assistant
6. Don't be robotic - be warm and personable

About Andrew:
- Name: Andrew Marshina  
- He's in New Jersey
- He's a high school student

When the call starts, greet the caller warmly and ask how you can help.`;

async function generateResponse(transcript, callData) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    console.log('📝 Transcript length:', transcript?.length || 0);
    console.log('📝 Last message:', transcript?.length > 0 ? transcript[transcript.length - 1] : 'none');
    
    // Build messages array
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];
    
    // Add conversation history
    if (transcript && transcript.length > 0) {
        transcript.forEach(msg => {
            // Retell uses 'agent' for bot and 'user' for human
            // OpenAI/Anthropic use 'assistant' for bot and 'user' for human
            const role = msg.role === 'agent' ? 'assistant' : 'user';
            messages.push({ role: role, content: msg.content });
        });
    }
    
    // If no API key, use smart fallback based on transcript
    if (!OPENROUTER_API_KEY) {
        console.log('⚠️ No OPENROUTER_API_KEY, using smart fallback');
        return getFallbackResponse(transcript);
    }
    
    try {
        console.log('🔄 Calling OpenRouter API...');
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
                max_tokens: 100
            })
        });
        
        const data = await response.json();
        console.log('📦 OpenRouter response:', JSON.stringify(data, null, 2));
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        }
        
        console.log('⚠️ Unexpected API response format');
        return getFallbackResponse(transcript);
    } catch (error) {
        console.error('❌ API error:', error.message);
        return getFallbackResponse(transcript);
    }
}

function getFallbackResponse(transcript) {
    // If this is the start (no transcript or empty), greet
    if (!transcript || transcript.length === 0) {
        return "Hello! I'm Tommy, Andrew's AI assistant. How can I help you today?";
    }
    
    const lastUserMsg = [...transcript].reverse().find(m => m.role === 'user');
    const userInput = lastUserMsg?.content?.toLowerCase() || '';
    
    console.log('🔍 Fallback - User said:', userInput);
    
    if (userInput.includes('hello') || userInput.includes('hi') || userInput.includes('hey')) {
        return "Hello! I'm Tommy, Andrew's AI assistant. What can I help you with?";
    }
    
    if (userInput.includes('your name') || userInput.includes('who are you')) {
        return "I'm Tommy, Andrew's AI assistant. Nice to meet you!";
    }
    
    if (userInput.includes('who made you') || userInput.includes('who created you')) {
        return "Andrew created me. I'm his AI assistant!";
    }
    
    if (userInput.includes('how are you')) {
        return "I'm doing great, thanks for asking! How can I help you?";
    }
    
    if (userInput.includes('thank')) {
        return "You're welcome! Is there anything else I can help with?";
    }
    
    if (userInput.includes('bye') || userInput.includes('goodbye')) {
        return "Goodbye! Have a great day!";
    }
    
    // Default response
    return "I'm here to help. Could you tell me more about what you need?";
}

wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';
    console.log('🔌 New WebSocket connection:', urlPath);
    
    // Extract call_id from path
    const pathParts = urlPath.split('/').filter(p => p);
    let callId = pathParts[pathParts.length - 1];
    
    if (!callId || callId === 'llm-websocket') {
        callId = 'call-' + Date.now();
    }
    
    console.log(`📞 Call ID: ${callId}`);
    activeCalls.set(callId, { ws, transcript: [] });
    
    // Send config event
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { 
            auto_reconnect: true, 
            call_details: true, 
            transcript_with_tool_calls: false 
        }
    }));
    console.log('📤 Sent config');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Received:', data.interaction_type || data.response_type, JSON.stringify(data).substring(0, 200));
            
            switch (data.interaction_type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ 
                        response_type: 'ping_pong', 
                        timestamp: Date.now() 
                    }));
                    console.log('📤 Sent ping_pong');
                    break;
                    
                case 'call_details':
                    console.log('📞 Call details:', JSON.stringify(data.call, null, 2));
                    break;
                    
                case 'update_only':
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
                    console.log('🎯 Response required, response_id:', data.response_id);
                    console.log('📋 Transcript so far:', JSON.stringify(data.transcript, null, 2));
                    
                    const callData = activeCalls.get(callId);
                    const transcript = callData?.transcript || data.transcript || [];
                    
                    const responseText = await generateResponse(transcript, callData);
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: responseText,
                        content_complete: true
                    }));
                    console.log(`📤 Sent: "${responseText}"`);
                    break;
                    
                case 'reminder_required':
                    console.log('⏰ Reminder required');
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: "Are you still there? How can I help you?",
                        content_complete: true
                    }));
                    break;
                    
                default:
                    console.log('❓ Unknown interaction type:', data.interaction_type);
            }
        } catch (err) {
            console.error('❌ Error:', err.message);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket closed:', callId);
        activeCalls.delete(callId);
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err.message);
    });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📥 Webhook:', req.body.event || req.body.type);
    res.status(204).send();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        connections: activeCalls.size, 
        apiKeySet: !!process.env.OPENROUTER_API_KEY,
        timestamp: new Date().toISOString() 
    });
});

// Root
app.get('/', (req, res) => {
    res.json({ 
        name: 'Tommy Voice Server',
        status: 'running',
        apiKeySet: !!process.env.OPENROUTER_API_KEY
    });
});

server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});