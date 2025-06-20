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

  try {
    const { metricEvaluations, metric, teacherGuidelines } = JSON.parse(event.body);

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
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      // Fallback consensus calculation
      parsedResponse = calculateFallbackConsensus(metricEvaluations, metric);
    }

    // Validate and ensure all fields are present
    const validatedResponse = {
      consensusScore: parsedResponse.consensusScore || calculateWeightedScore(metricEvaluations),
      reasoning: parsedResponse.reasoning || 'Consensus reached through weighted evaluation',
      agreements: parsedResponse.agreements || ['General consensus on evaluation'],
      disagreements: parsedResponse.disagreements || [],
      confidence: parsedResponse.confidence || 85,
      flagsForReview: parsedResponse.flagsForReview || [],
      synthesizedFeedback: parsedResponse.synthesizedFeedback || 'Comprehensive evaluation completed',
      keyStrengths: parsedResponse.keyStrengths || [],
      keyWeaknesses: parsedResponse.keyWeaknesses || [],
      priorityRecommendations: parsedResponse.priorityRecommendations || []
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
        error: error.message
      })
    };
  }
};

function calculateWeightedScore(evaluations) {
  let totalScore = 0;
  let totalWeight = 0;
  
  evaluations.forEach(eval => {
    const weight = eval.isPrimary ? 0.6 : (0.4 / Math.max(1, evaluations.length - 1));
    if (eval.evaluation && eval.evaluation.score !== undefined) {
      totalScore += eval.evaluation.score * weight;
      totalWeight += weight;
    }
  });
  
  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 75;
}

function calculateFallbackConsensus(evaluations, metric) {
  const scores = evaluations.map(e => e.evaluation?.score || 75);
  const weightedScore = calculateWeightedScore(evaluations);
  
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;
  
  const agreements = [];
  const disagreements = [];
  const flagsForReview = [];
  
  if (range <= 5) {
    agreements.push(`Strong consensus on ${metric.name} evaluation (range: ${range} points)`);
  } else if (range <= 10) {
    agreements.push(`General agreement on ${metric.name} with minor variations (range: ${range} points)`);
  } else {
    disagreements.push(`Significant variation in ${metric.name} scores (range: ${range} points)`);
    if (range > 15) {
      flagsForReview.push(`Large score discrepancy (${range} points) requires instructor review`);
    }
  }
  
  // Check for low scores
  if (weightedScore < 70) {
    flagsForReview.push(`Score below industry standard (70%) - requires attention`);
  }
  
  // Aggregate strengths and weaknesses
  const allStrengths = [];
  const allWeaknesses = [];
  
  evaluations.forEach(eval => {
    if (eval.evaluation) {
      if (eval.evaluation.specificStrengths) {
        allStrengths.push(...eval.evaluation.specificStrengths);
      }
      if (eval.evaluation.specificWeaknesses) {
        allWeaknesses.push(...eval.evaluation.specificWeaknesses);
      }
    }
  });
  
  // Get unique top items
  const keyStrengths = [...new Set(allStrengths)].slice(0, 2);
  const keyWeaknesses = [...new Set(allWeaknesses)].slice(0, 2);
  
  const avgConfidence = evaluations.reduce((sum, e) => 
    sum + (e.evaluation?.confidence || 80), 0) / evaluations.length;
  
  return {
    consensusScore: weightedScore,
    reasoning: `Weighted consensus: Primary evaluator (60%), Supporting evaluators (${40 / Math.max(1, evaluations.length - 1)}% each)`,
    agreements: agreements,
    disagreements: disagreements,
    confidence: Math.round(avgConfidence),
    flagsForReview: flagsForReview,
    synthesizedFeedback: `Based on ${evaluations.length} expert evaluations for ${metric.name}`,
    keyStrengths: keyStrengths.length > 0 ? keyStrengths : ['Meets basic requirements'],
    keyWeaknesses: keyWeaknesses.length > 0 ? keyWeaknesses : ['Areas for improvement identified'],
    priorityRecommendations: ['Focus on addressing identified weaknesses', 'Build upon existing strengths']
  };
}