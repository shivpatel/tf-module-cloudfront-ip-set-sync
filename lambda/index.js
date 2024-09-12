const https = require('https');
const AWS = require('aws-sdk');

const wafv2 = new AWS.WAFV2({ region: process.env.AWS_REGION });

/**
 * Fetch IP ranges from the provided URL.
 * @param {string} url - The URL to fetch the IP ranges from.
 * @returns {Promise<string[]>} A promise that resolves with an array of CloudFront IP ranges.
 */
const getIpRangesFromUrl = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          const cloudFrontRanges = parsedData.prefixes
            .filter(prefix => prefix.service === 'CLOUDFRONT')
            .map(prefix => prefix.ip_prefix);
          resolve(cloudFrontRanges);
        } catch (error) {
          reject(`Error parsing IP ranges JSON: ${error.message}`);
        }
      });
    }).on('error', error => {
      reject(`Error fetching IP ranges JSON from ${url}: ${error.message}`);
    });
  });
};

/**
 * Update the WAF IP set with the new CloudFront IP ranges.
 * @param {string} ipSetId - The ID of the WAF IP set.
 * @param {string} ipSetName - The name of the WAF IP set.
 * @param {string[]} cloudFrontRanges - The CloudFront IP ranges to update in the WAF IP set.
 * @returns {Promise<void>}
 */
const updateWafIpSet = async (ipSetId, ipSetName, cloudFrontRanges) => {
  try {
    // Get the current IP set to retrieve the LockToken
    const ipSetResponse = await wafv2.getIPSet({
      Name: ipSetName,
      Scope: 'REGIONAL', // Use 'CLOUDFRONT' for global scope WAF IP sets
      Id: ipSetId
    }).promise();
    
    const lockToken = ipSetResponse.LockToken;
    
    // Update the WAF IP set with new CloudFront IP ranges
    await wafv2.updateIPSet({
      Name: ipSetName,
      Scope: 'REGIONAL',  // Use 'CLOUDFRONT' for global scope WAF IP sets
      Id: ipSetId,
      Addresses: cloudFrontRanges,
      LockToken: lockToken
    }).promise();
    
    console.log('WAF IP set updated successfully');
  } catch (error) {
    console.error(`Error updating WAF IP set: ${error.message}`);
    throw error;
  }
};

/**
 * The Lambda function handler.
 * @param {object} event - The event object passed by AWS Lambda.
 * @param {object} context - The context object passed by AWS Lambda.
 */
exports.handler = async (event, context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const wafIpSetId = process.env.WAF_IP_SET_ID;
  const wafIpSetName = process.env.WAF_IP_SET_NAME;

  // Extract the URL from the SNS message
  const snsMessage = event.Records[0].Sns.Message;
  const parsedMessage = JSON.parse(snsMessage);
  const ipRangesUrl = parsedMessage.url;

  if (!ipRangesUrl) {
    console.error('No URL found in the SNS event message');
    return {
      statusCode: 400,
      body: JSON.stringify('Invalid event: URL not provided')
    };
  }

  try {
    // Fetch CloudFront IP ranges using the provided URL
    const cloudFrontRanges = await getIpRangesFromUrl(ipRangesUrl);
    console.log('Fetched CloudFront IP ranges:', cloudFrontRanges);
    
    // Update WAF IP set with CloudFront IP ranges
    await updateWafIpSet(wafIpSetId, wafIpSetName, cloudFrontRanges);
    
    return {
      statusCode: 200,
      body: JSON.stringify('WAF IP set updated successfully')
    };
  } catch (error) {
    console.error('Error updating WAF IP set:', error);
    return {
      statusCode: 500,
      body: JSON.stringify(`Error updating WAF IP set: ${error.message}`)
    };
  }
};
