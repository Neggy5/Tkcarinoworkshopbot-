const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

let isAutoLoadRunning = false;
let isShuttingDown = false;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

process.on('message', (msg) => {
  if (msg === 'shutdown') {
    console.log(chalk.yellow('🛑 Received PM2 shutdown signal'));
    isShuttingDown = true;
  }
});

process.on('SIGINT', () => {
  console.log(chalk.yellow('🛑 Received SIGINT signal'));
  isShuttingDown = true;
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('🛑 Received SIGTERM signal'));
  isShuttingDown = true;
});

// Helper function to process a single user
async function processUser(user, index, total) {
  if (isShuttingDown) {
    throw new Error('Shutdown in progress');
  }
  
  console.log(chalk.blue(`⌛ Connecting ${index + 1}/${total}: ${user}`));
  
  try {
    // Dynamic require to ensure fresh module each time
    const pairModule = require('./pair');
    const startpairingFn = typeof pairModule === 'function' ? pairModule : pairModule.startpairing;
    if (typeof startpairingFn !== 'function') {
      throw new Error('startpairing is not a function - module exports: ' + typeof pairModule);
    }
    await startpairingFn(user);
    console.log(chalk.green(`✅ Connected: ${user}`));
    return user;
  } catch (error) {
    console.log(chalk.red(`❌ Failed for ${user}: ${error.message}`));
    throw error;
  }
}

// Helper function to process users in batches
async function processBatch(users, batchSize = 3) {
  const results = [];
  const failedUsers = [];
  
  for (let i = 0; i < users.length; i += batchSize) {
    if (isShuttingDown) {
      console.log(chalk.yellow('⏹️ Stopping batch processing due to shutdown'));
      break;
    }
    
    const batch = users.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(users.length / batchSize);
    
    console.log(chalk.cyan(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} users)`));
    
    // Process each user in batch sequentially
    for (let j = 0; j < batch.length; j++) {
      const user = batch[j];
      if (isShuttingDown) break;
      const userIndex = i + j;
      try {
        await processUser(user, userIndex, users.length);
        results.push({ status: 'fulfilled', value: user });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
        failedUsers.push(user);
      }
      
      // Add delay between users in same batch
      if (j < batch.length - 1 && !isShuttingDown) {
        await delay(3000);
      }
    }
    
    // Longer delay between batches
    if (i + batchSize < users.length && !isShuttingDown) {
      console.log(chalk.gray(`⏳ Waiting 5 seconds before next batch...`));
      await delay(5000);
    }
  }
  
  return { results, failedUsers };
}

// Helper function to count successful results
function countSuccessful(results) {
  return results.filter(result => result.status === 'fulfilled').length;
}

module.exports = {
  autoLoadPairs: async (options = {}) => {
    if (isShuttingDown) {
      console.log(chalk.yellow('⚠️ Skipping auto-load (shutdown in progress)'));
      return { success: false, message: 'Shutdown in progress' };
    }
    
    if (isAutoLoadRunning) {
      console.log(chalk.yellow('⚠️ Auto-load already in progress. Skipping...'));
      return { success: false, message: 'Auto-load already running' };
    }
    
    isAutoLoadRunning = true;
    console.log(chalk.yellow('🔄 Auto-loading all paired users...'));

    try {
      const pairingDir = path.join(__dirname, 'empirestore', 'pairing');
      
      // Check if pairing directory exists
      try {
        await fs.access(pairingDir);
      } catch {
        console.log(chalk.red('❌ Pairing directory not found.'));
        return { success: false, message: 'Pairing directory not found', total: 0, successful: 0 };
      }

      // Read all directories in pairing folder
      const files = await fs.readdir(pairingDir, { withFileTypes: true });
      const pairUsers = files
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => name.endsWith('@s.whatsapp.net'));

      if (pairUsers.length === 0) {
        console.log(chalk.yellow('ℹ️ No paired users found.'));
        return { success: true, message: 'No users to load', total: 0, successful: 0 };
      }

      console.log(chalk.green(`✅ Found ${pairUsers.length} paired users. Starting connections...`));

      const startTime = Date.now();
      const batchSize = options.batchSize || 2;  // Start with very small batches
      console.log(chalk.cyan(`🔄 Processing users in batches of ${batchSize}...`));
      console.log(chalk.yellow('⏳ Waiting 2 seconds before starting...'));
      await delay(2000);
      
      const { results, failedUsers } = await processBatch(pairUsers, batchSize);
      const successful = countSuccessful(results);
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      const failed = pairUsers.length - successful;
      
      console.log(chalk.green(`🎉 Auto-load completed in ${duration} seconds`));
      console.log(chalk.cyan(`📊 Success: ${successful} | Failed: ${failed} | Total: ${pairUsers.length}`));
      
      if (failedUsers.length > 0) {
        console.log(chalk.yellow(`⚠️ Failed users: ${failedUsers.join(', ')}`));
      }
      
      return {
        success: true,
        total: pairUsers.length,
        successful: successful,
        failed: failed,
        duration: duration,
        failedUsers: failedUsers
      };
      
    } catch (error) {
      console.error(chalk.red('❌ Auto-load error:'), error);
      return {
        success: false,
        message: error.message,
        total: 0,
        successful: 0
      };
    } finally {
      isAutoLoadRunning = false;
    }
  },
  
  // Export status checkers for external use
  isRunning: () => isAutoLoadRunning,
  isShuttingDown: () => isShuttingDown
};