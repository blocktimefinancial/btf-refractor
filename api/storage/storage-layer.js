const FsDataProvider = require("./fs-data-provider"),
  MongooseDataProvider = require("./mongoose-data-provider"),
  InMemoryDataProvider = require("./inmemory-data-provider"),
  { storage } = require("../app.config");

class StorageLayer {
  async initDataProvider(providerName = storage) {
    if (!this.dataProvider) {
      let provider;
      switch (providerName) {
        case "fs":
          provider = new FsDataProvider();
          break;
        case "mongoose":
          provider = new MongooseDataProvider();
          break;
        case "inmemory":
          provider = new InMemoryDataProvider();
          break;
        default:
          throw new Error(
            `Unsupported data provider storage engine: ${providerName}`,
          );
      }
      await provider.init();
      this.dataProvider = provider;
    }
    return this.dataProvider;
  }

  /**
   * @type {DataProvider}
   */
  dataProvider;

  /**
   * Close the active data provider and release resources.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.dataProvider) {
      await this.dataProvider.close();
      this.dataProvider = null;
    }
  }
}

const storageLayer = new StorageLayer();

module.exports = storageLayer;
