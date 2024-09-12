provider "aws" {
  region = var.region
}

resource "aws_wafv2_ip_set" "cloudfront_ip_set" {
  name        = "CloudFrontIPSet"
  scope       = "REGIONAL"  # Use CLOUDFRONT if needed for global WAF
  ip_address_version = "IPV4"
  addresses   = []
}

resource "aws_lambda_function" "update_waf_ip_set" {
  filename      = data.archive_file.lambda_zip.output_path
  function_name = "CloudFrontIPSet-Updater"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  environment {
    variables = {
      WAF_IP_SET_ID   = aws_wafv2_ip_set.cloudfront_ip_set.id
      WAF_IP_SET_NAME = aws_wafv2_ip_set.cloudfront_ip_set.name
    }
  }
}

resource "aws_iam_role" "lambda_role" {
  name = "CloudFrontIPSet-Updater"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole",
      Effect = "Allow",
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "lambda_waf_update_policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = [
          "wafv2:UpdateIPSet",
          "wafv2:GetIPSet",
          "wafv2:ListIPSets"
        ],
        Effect   = "Allow",
        Resource = "*"
      },
      {
        Action = "logs:*",
        Effect   = "Allow",
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "subscribe_amazon_ip_space" {
  topic_arn = "arn:aws:sns:us-east-1:806199016981:AmazonIpSpaceChanged"
  protocol  = "lambda"
  endpoint  = aws_lambda_function.update_waf_ip_set.arn
}

resource "aws_lambda_permission" "allow_sns_lambda" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_waf_ip_set.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic_subscription.subscribe_amazon_ip_space.topic_arn
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda/lambda.zip"
}