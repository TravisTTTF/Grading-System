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
    const { agentId, agentPrompt, content, specificMetric, teacherGuidelines, apiSettings } = JSON.parse(event.body);

    // Construct the prompt for the specific agent and metric
    const systemPrompt = `You are an expert AI agent specializing in evaluating engineering reports. 

Agent Role: ${getAgentRole(agentId)}

${agentPrompt}

IMPORTANT: You are evaluating ONLY the following specific aspect:
Metric Name: ${specificMetric.name}
Weight: ${specificMetric.weight}%
Evaluation Criteria: ${specificMetric.description}

${teacherGuidelines ? `Additional Teacher Guidelines:\n${teacherGuidelines}` : ''}

Please evaluate ONLY this specific metric and provide:
1. A numerical score (0-100) based on engineering standards
2. Detailed technical feedback with specific examples from the report
3. Your confidence level (0-100%) in your assessment
4. Clear reasoning for your score

Consider industry standards where:
- 90-100: Exceptional work exceeding professional standards
- 80-89: Strong performance meeting all requirements
- 70-79: Adequate work meeting minimum professional standards
- 60-69: Below standards with significant issues
- Below 60: Unacceptable for professional engineering work

Format your response as JSON:
{
  "score": numerical_score,
  "feedback": "detailed technical feedback with specific examples",
  "confidence": confidence_percentage,
  "reasoning": "clear explanation of how you arrived at this score",
  "specificStrengths": ["strength 1", "strength 2"],
  "specificWeaknesses": ["weakness 1", "weakness 2"],
  "recommendations": ["specific recommendation 1", "specific recommendation 2"]
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
            content: `Engineering Report to Evaluate:\n\n${content}\n\nPlease evaluate ONLY the "${specificMetric.name}" aspect of this report.`
          }
        ],
        temperature: 0.3, // Lower temperature for consistent grading
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
      // If JSON parsing fails, create a structured response from the text
      parsedResponse = extractStructuredResponse(aiResponse, specificMetric);
    }

    // Ensure all required fields are present
    const validatedResponse = {
      score: parsedResponse.score || 75,
      feedback: parsedResponse.feedback || `Evaluation completed for ${specificMetric.name}.`,
      confidence: parsedResponse.confidence || 80,
      reasoning: parsedResponse.reasoning || 'Based on engineering standards and best practices.',
      specificStrengths: parsedResponse.specificStrengths || [],
      specificWeaknesses: parsedResponse.specificWeaknesses || [],
      recommendations: parsedResponse.recommendations || []
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        agentId,
        metric: specificMetric.name,
        result: validatedResponse
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
    1: "Technical Content Expert - Specializing in engineering calculations, methodology, and technical accuracy",
    2: "Technical Writing Expert - Specializing in professional engineering documentation and communication",
    3: "Report Structure Expert - Specializing in engineering report organization and formatting standards",
    4: "Engineering Innovation Expert - Specializing in creative problem-solving and forward-thinking approaches"
  };
  return roles[agentId] || "Engineering Evaluator";
}

function extractStructuredResponse(text, metric) {
  // Extract score from text using various patterns
  const scorePatterns = [
    /score[:\s]*(\d+)/i,
    /(\d+)\s*(?:out of\s*)?(?:\/\s*)?100/i,
    /grade[:\s]*(\d+)/i
  ];
  
  let score = 75; // default
  for (const pattern of scorePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      score = parseInt(match[1]);
      break;
    }
  }
  
  // Extract confidence
  const confidencePattern = /confidence[:\s]*(\d+)/i;
  const confidenceMatch = text.match(confidencePattern);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 80;
  
  // Extract strengths and weaknesses
  const strengths = [];
  const weaknesses = [];
  
  const strengthPatterns = [
    /strengths?[:\s]*(.*?)(?:weakness|$)/is,
    /positive[:\s]*(.*?)(?:negative|weakness|$)/is
  ];
  
  const weaknessPatterns = [
    /weakness(?:es)?[:\s]*(.*?)(?:recommendation|$)/is,
    /negative[:\s]*(.*?)(?:recommendation|$)/is,
    /improve(?:ment)?[:\s]*(.*?)(?:recommendation|$)/is
  ];
  
  for (const pattern of strengthPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const items = match[1].split(/[•\-\*\n]/).filter(item => item.trim().length > 10);
      strengths.push(...items.slice(0, 3).map(item => item.trim()));
      break;
    }
  }
  
  for (const pattern of weaknessPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const items = match[1].split(/[•\-\*\n]/).filter(item => item.trim().length > 10);
      weaknesses.push(...items.slice(0, 3).map(item => item.trim()));
      break;
    }
  }
  
  // Extract recommendations
  const recommendations = [];
  const recPattern = /recommend(?:ation)?s?[:\s]*(.*?)$/is;
  const recMatch = text.match(recPattern);
  if (recMatch && recMatch[1]) {
    const items = recMatch[1].split(/[•\-\*\n]/).filter(item => item.trim().length > 10);
    recommendations.push(...items.slice(0, 3).map(item => item.trim()));
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    feedback: `Based on evaluation of ${metric.name}: ${text.slice(0, 300)}...`,
    confidence: Math.max(0, Math.min(100, confidence)),
    reasoning: text.slice(0, 500),
    specificStrengths: strengths.length > 0 ? strengths : ['Evaluation completed'],
    specificWeaknesses: weaknesses.length > 0 ? weaknesses : ['Areas for improvement identified'],
    recommendations: recommendations.length > 0 ? recommendations : ['Continue following engineering best practices']
  };
}
    