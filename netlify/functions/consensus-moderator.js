// netlify/functions/consensus-moderator.js
exports.handler = async (event, context) => {
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
    const { metricEvaluations, metric, teacherGuidelines } = JSON.parse(event.body);

    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured in environment variables');
    }

    const systemPrompt = `You are a Consensus Moderator AI specializing in engineering report evaluation.

Your task is to synthesize evaluations from multiple expert agents for a specific metric and provide a balanced consensus.

Metric Being Evaluated: ${metric.name}
Metric Description: ${metric.description}
Metric Weight: ${metric.weight}%

Agent Evaluations to Synthesize:
${JSON.stringify(metricEvaluations, null, 2)}

${teacherGuidelines ? `Teacher Guidelines:\n${teacherGuidelines}` : ''}

Provide your consensus analysis considering:
1. Give more weight to the primary evaluator's assessment (60% weight)
2. Consider supporting evaluators' perspectives (40% weight total)
3. Identify areas of agreement and disagreement
4. Flag any significant discrepancies for instructor review
5. Ensure the final score aligns with engineering industry standards

Format your response as JSON:
{
  "consensusScore": weighted_final_score,
  "reasoning": "explanation of how consensus was reached",
  "agreements": ["area of agreement 1", "area of agreement 2"],
  "disagreements": ["area of disagreement 1", "area of disagreement 2"],
  "confidence": overall_confidence_percentage,
  "flagsForReview": ["specific concerns needing instructor attention"],
  "synthesizedFeedback": "comprehensive feedback combining all perspectives",
  "keyStrengths": ["main strength from consensus", "another strength"],
  "keyWeaknesses": ["main weakness from consensus", "another weakness"],
  "priorityRecommendations": ["top recommendation", "second recommendation"]
}`;

    console.log('Calling OpenAI API for consensus');

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
            content: 'Please analyze the agent evaluations and provide your consensus assessment for this specific metric.'
          }
        ],
        temperature: 0.2, // Low temperature for consistent consensus
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }

    const aiResponse = data.choices[0].message.content;
    console.log('Received consensus response:', aiResponse);

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse consensus response as JSON:', parseError);
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error('Consensus response is not valid JSON. Response: ' + aiResponse);
        }
      } else {
        throw new Error('Consensus response does not contain valid JSON. Response: ' + aiResponse);
      }
    }

    // Validate required fields
    if (typeof parsedResponse.consensusScore !== 'number') {
      throw new Error('Consensus response missing required "consensusScore" field');
    }

    // Validate and ensure all fields are present
    const validatedResponse = {
      consensusScore: parsedResponse.consensusScore,
      reasoning: parsedResponse.reasoning || 'Consensus reached through weighted evaluation',
      agreements: Array.isArray(parsedResponse.agreements) ? parsedResponse.agreements : ['General consensus on evaluation'],
      disagreements: Array.isArray(parsedResponse.disagreements) ? parsedResponse.disagreements : [],
      confidence: parsedResponse.confidence || 85,
      flagsForReview: Array.isArray(parsedResponse.flagsForReview) ? parsedResponse.flagsForReview : [],
      synthesizedFeedback: parsedResponse.synthesizedFeedback || 'Comprehensive evaluation completed',
      keyStrengths: Array.isArray(parsedResponse.keyStrengths) ? parsedResponse.keyStrengths : [],
      keyWeaknesses: Array.isArray(parsedResponse.keyWeaknesses) ? parsedResponse.keyWeaknesses : [],
      priorityRecommendations: Array.isArray(parsedResponse.priorityRecommendations) ? parsedResponse.priorityRecommendations : []
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        consensus: validatedResponse
      })
    };

  } catch (error) {
    console.error('Consensus error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: error.stack
      })
    };
  }
};