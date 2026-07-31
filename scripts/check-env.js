import {
  assertDeployConfig,
  collectPaymentConfigIssues,
  config,
  environmentInfo,
  getPayOSCancelUrl,
  getPayOSReturnUrl,
  getWebhookUrl,
} from '../src/config.js';

console.log('=== Cream Store Bot v7 :: ENV CHECK ===');
console.log('cwd                 :', environmentInfo.cwd);
console.log('projectRoot         :', environmentInfo.projectRoot);
console.log('envPath             :', environmentInfo.envPath);
console.log('envFileExists       :', environmentInfo.envFileExists);
console.log('clientId            :', config.clientId ?? '(missing)');
console.log('guildId             :', config.guildId ?? '(missing)');
console.log('botToken            :', config.botToken ? '(configured)' : '(missing)');
console.log('databasePath        :', config.databasePath);
console.log('storeName           :', config.storeName);
console.log('paymentProvider     :', config.paymentProvider);
console.log('payosClientId       :', config.payosClientId ? '(configured)' : '(missing)');
console.log('payosApiKey         :', config.payosApiKey ? '(configured)' : '(missing)');
console.log('payosChecksumKey    :', config.payosChecksumKey ? '(configured)' : '(missing)');
console.log('payosWebhookUrl     :', getWebhookUrl() ?? '(missing PUBLIC_BASE_URL)');
console.log('payosReturnUrl      :', getPayOSReturnUrl() ?? '(missing PUBLIC_BASE_URL)');
console.log('payosCancelUrl      :', getPayOSCancelUrl() ?? '(missing PUBLIC_BASE_URL)');

try {
  assertDeployConfig();
  const paymentIssues = collectPaymentConfigIssues();
  if (paymentIssues.length) {
    console.log('RESULT              : WARN');
    console.log(paymentIssues.join('\n'));
    process.exit(1);
  }
  console.log('RESULT              : OK');
} catch (error) {
  console.error('RESULT              : FAIL');
  console.error(error.message);
  process.exit(1);
}
