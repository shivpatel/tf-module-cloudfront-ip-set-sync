const https = require('https');
const AWS = require('aws-sdk');

const wafv2 = new AWS.WAFV2({ region: process.env.AWS_REGION });

/**
 * Fetch CloudFront IP ranges from AWS public IP ranges JSON.
 * @returns {Promise<string[]>} A promise that resolves with an array of CloudFront IP ranges.
 */
const getCloudFrontIpRanges = () => {
  const url = 'https://ip-ranges.amazonaws.com/ip-ranges.json';
  
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
      reject(`Error fetching IP ranges JSON: ${error.message}`);
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
  
  try {
    // Fetch CloudFront IP ranges
    const cloudFrontRanges = await getCloudFrontIpRanges();
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