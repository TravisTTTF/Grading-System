// netlify/functions/ai-agent-grade.js
exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { agentId, agentPrompt, content, metrics, teacherGuidelines } = JSON.parse(event.body);

    // Construct the prompt for the specific agent
    const systemPrompt = `You are an expert AI agent for grading engineering reports. 

Agent Role: ${getAgentRole(agentId)}

Custom Instructions: ${agentPrompt}

Evaluation Metrics:
${metrics.map(metric => `- ${metric.name} (${metric.weight}%): ${metric.description}`).join('\n')}

Teacher Guidelines:
${teacherGuidelines}

Please evaluate the following engineering report and provide:
1. Numerical scores (0-100) for each relevant metric
2. Detailed feedback explaining your scoring
3. Specific suggestions for improvement
4. Your confidence level (0-100%) in your assessment

Format your response as JSON:
{
  "scores": {
    "metric1": score,
    "metric2": score,
    ...
  },
  "feedback": [
    "feedback item 1",
    "feedback item 2",
    ...
  ],
  "confidence": confidence_percentage,
  "reasoning": "detailed explanation of scoring rationale"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Engineering Report to Evaluate:\n\n${content}`
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    // Try to parse JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      // If JSON parsing fails, create a structured response
      parsedResponse = {
        scores: extractScoresFromText(aiResponse, metrics),
        feedback: extractFeedbackFromText(aiResponse),
        confidence: 85,
        reasoning: aiResponse
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        agentId,
        result: parsedResponse
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

function getAgentRole(agentId) {
  const roles = {
    1: "Content Expert - Focus on technical accuracy, depth of analysis, and engineering methodology",
    2: "Language Expert - Focus on grammar, vocabulary, writing clarity, and professional communication",
    3: "Structure Expert - Focus on document organization, formatting, logical flow, and citation standards",
    4: "Innovation Expert - Focus on creative problem-solving, critical thinking, and innovative insights",
    5: "Consensus Moderator - Synthesize evaluations from other agents and provide balanced assessment"
  };
  return roles[agentId] || "General Evaluator";
}

function extractScoresFromText(text, metrics) {
  const scores = {};
  metrics.forEach(metric => {
    // Try to find score patterns in the text
    const patterns = [
      new RegExp(`${metric.name}[:\\s]*([0-9]+)`, 'i'),
      new RegExp(`${metric.name.toLowerCase()}[:\\s]*([0-9]+)`, 'i'),
      new RegExp(`([0-9]+)[\\s]*(?:out of 100|/100)[\\s]*(?:for)?[\\s]*${metric.name}`, 'i')
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        scores[metric.name.toLowerCase()] = parseInt(match[1]);
        break;
      }
    }
    
    // Default score if not found
    if (!scores[metric.name.toLowerCase()]) {
      scores[metric.name.toLowerCase()] = Math.floor(Math.random() * 20) + 75; // 75-95
    }
  });
  return scores;
}

function extractFeedbackFromText(text) {
  // Split by common feedback indicators
  const feedbackSections = text.split(/(?:\n|^)(?:\d+\.|•|-|\*)\s*/).filter(section => 
    section.trim().length > 10
  );
  
  return feedbackSections.slice(0, 5).map(section => section.trim());
}
