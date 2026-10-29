import original from '../../config/playwright/playwright.issue37.config';
export default { ...original, testDir: '../../tests', outputDir: '../organization-profile/regression-results', use: {...original.use, channel:'chrome'} };
