// netlify/functions/test-api.js
// 简化测试函数 - 先用这个测试基础连通性

exports.handler = async (event, context) => {
  console.log('Test function called!');
  console.log('HTTP Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight successful' })
    };
  }

  // Test environment variables
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  const apiKeyLength = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0;
  
  console.log('API Key present:', hasApiKey);
  console.log('API Key length:', apiKeyLength);

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Test function working!',
        timestamp: new Date().toISOString(),
        hasApiKey: hasApiKey,
        apiKeyLength: apiKeyLength,
        environment: 'netlify-functions'
      })
    };
  }

  if (event.httpMethod === 'POST') {
    try {
      console.log('POST request body:', event.body);
      
      const requestData = JSON.parse(event.body || '{}');
      console.log('Parsed request data:', requestData);

      // Test OpenAI API call if key is available
      if (hasApiKey) {
        try {
          console.log('Testing OpenAI API call...');
          
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [
                {
                  role: 'user',
                  content: 'Say "API test successful" and nothing else.'
                }
              ],
              max_tokens: 10,
              temperature: 0
            })
          });

          console.log('OpenAI API response status:', response.status);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI API error:', errorText);
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          console.log('OpenAI API success:', data);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'OpenAI API test successful!',
              openaiResponse: data.choices[0].message.content,
              timestamp: new Date().toISOString()
            })
          };

        } catch (apiError) {
          console.error('OpenAI API test failed:', apiError);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: false,
              message: 'Function works but OpenAI API failed',
              error: apiError.message,
              hasApiKey: true,
              timestamp: new Date().toISOString()
            })
          };
        }
      } else {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: false,
            message: 'Function works but no API key configured',
            hasApiKey: false,
            timestamp: new Date().toISOString()
          })
        };
      }

    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid JSON in request body',
          timestamp: new Date().toISOString()
        })
      };
    }
  }

  // Unsupported method
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({
      error: 'Method not allowed',
      allowedMethods: ['GET', 'POST', 'OPTIONS']
    })
  };
};
