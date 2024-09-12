output "waf_ip_set_id" {
  description = "WAF IP Set ID"
  value       = aws_wafv2_ip_set.cloudfront_ip_set.id
}