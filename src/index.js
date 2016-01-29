import async from 'async';
import azure from 'azure-storage';

function base64urlEncode(value) {
  return new Buffer(value).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
}

module.exports = function(options) {
  options = {
    registrationContainer: 'letsencrypt-registrations',
    challengeContainer: 'letsencrypt-challenges',
    removeChallenges: true,
    ...options
  };

  const blobService = azure.createBlobService(options.accountName, options.accountKey);

  return (on, logger) => {
    function createContainer(name, level, callback) {
      try {
        logger.debug(`Creating container: ${name} (${level || 'private'}).`);
        blobService.createContainerIfNotExists(name, { publicAccessLevel : level }, (err) => callback(err));
      } catch (e) {
        return callback(e);
      }
    }

    function saveBlob(container, name, text, callback) {
      try {
        logger.debug(`Saving blob '${name}' to ${container}.`);
        blobService.createBlockBlobFromText(container, name, text, callback);
      } catch (e) {
        return callback(e);
      }
    }

    function readBlob(container, name, callback) {
      try {
        logger.debug(`Reading blob '${name}' from ${container}.`);
        blobService.getBlobToText(container, name, callback);
      } catch (e) {
        return callback(e);
      }
    }

    function deleteBlob(container, name, callback) {
      try {
        logger.debug(`Deleting blob '${name}' from ${container}.`);
        blobService.deleteBlob(container, name, callback);
      } catch (e) {
        return callback(e);
      }
    }

    on('registration:load', (context, callback) => {
      logger.debug(`Attempting to load registration data from Blob Storage.`);

      async.waterfall([
        (cb) => createContainer(options.registrationContainer, null, cb),
        (cb) => readBlob(options.registrationContainer, base64urlEncode(context.email) + '.json', cb)
      ],
      (err, blobContents) => {
        if (err) {
          if (err.code === 'BlobNotFound') {
            return callback();
          }
          return callback(err);
        }

        if (blobContents) {
          return callback(null, JSON.parse(blobContents));
        }

        return callback();
      });
    });

    on('registration:save', (context, callback) => {
      logger.debug(`Existing registration not found. A new registration will be saved in the ${options.registrationContainer} container.`);

      const data = {
        privateKey: context.privateKey,
        registration: context.registration
      };

      async.waterfall([
        (cb) => createContainer(options.registrationContainer, null, cb),
        (cb) => saveBlob(options.registrationContainer, base64urlEncode(context.email) + '.json', JSON.stringify(data, null, 2), cb)
      ],
      (err) => {
        if (err) {
          return callback(err);
        }
        return callback();
      });
    });

    on('challenge:save', (context, callback) => {
      logger.info(`Saving challenge for ${context.hostname} to the ${options.challengeContainer} container.`);

      async.waterfall([
        (cb) => createContainer(options.challengeContainer, 'blob', cb),
        (cb) => saveBlob(options.challengeContainer, context.key, context.value, cb)
      ],
      (err) => {
        if (err) {
          return callback(err);
        }
        return callback();
      });
    });

    on('challenge:remove', (context, callback) => {
      if (!options.removeChallenges) {
        return callback();
      }

      logger.info(`Removing challenge for '${context.hostname}' from the ${options.challengeContainer} container.`);

      async.waterfall([
        (cb) => createContainer(options.challengeContainer, 'blob', cb),
        (cb) => deleteBlob(options.challengeContainer, context.key, cb)
      ],
      (err) => {
        if (err) {
          return callback(err);
        }
        return callback();
      });
    });
  };
};
