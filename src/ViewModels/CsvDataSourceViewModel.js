'use strict';

/*global require,L,URI,Document*/

var CesiumMath = require('../../third_party/cesium/Source/Core/Math');
var clone = require('../../third_party/cesium/Source/Core/clone');
var Color = require('../../third_party/cesium/Source/Core/Color');
var ColorMaterialProperty = require('../../third_party/cesium/Source/DataSources/ColorMaterialProperty');
var combine = require('../../third_party/cesium/Source/Core/combine');
var ConstantProperty = require('../../third_party/cesium/Source/DataSources/ConstantProperty');
var defaultValue = require('../../third_party/cesium/Source/Core/defaultValue');
var defined = require('../../third_party/cesium/Source/Core/defined');
var defineProperties = require('../../third_party/cesium/Source/Core/defineProperties');
var DeveloperError = require('../../third_party/cesium/Source/Core/DeveloperError');
var freezeObject = require('../../third_party/cesium/Source/Core/freezeObject');
var knockout = require('../../third_party/cesium/Source/ThirdParty/knockout');
var loadJson = require('../../third_party/cesium/Source/Core/loadJson');
var loadXML = require('../../third_party/cesium/Source/Core/loadXML');
var Rectangle = require('../../third_party/cesium/Source/Core/Rectangle');
var when = require('../../third_party/cesium/Source/ThirdParty/when');

var TableDataSource = require('../TableDataSource');

var corsProxy = require('../corsProxy');
var DataSourceMetadataViewModel = require('./DataSourceMetadataViewModel');
var DataSourceMetadataItemViewModel = require('./DataSourceMetadataItemViewModel');
var GeoDataCatalogError = require('./GeoDataCatalogError');
var GeoDataSourceViewModel = require('./GeoDataSourceViewModel');
var ImageryLayerDataSourceViewModel = require('./ImageryLayerDataSourceViewModel');
var inherit = require('../inherit');
var rectangleToLatLngBounds = require('../rectangleToLatLngBounds');
var readText = require('../readText');
var runLater = require('../runLater');

/**
 * A {@link GeoDataSourceViewModel} representing CSV data.
 *
 * @alias CsvDataSourceViewModel
 * @constructor
 * @extends GeoDataSourceViewModel
 * 
 * @param {GeoDataCatalogContext} context The context for the group.
 * @param {String} [url] The URL from which to retrieve the CSV data.
 */
var CsvDataSourceViewModel = function(context, url) {
    GeoDataSourceViewModel.call(this, context);

    this._tableDataSource = undefined;

    /**
     * Gets or sets the URL from which to retrieve GeoJSON data.  This property is ignored if
     * {@link GeoJsonDataSourceViewModel#data} is defined.  This property is observable.
     * @type {String}
     */
    this.url = url;

    /**
     * Gets or sets the CSV data, represented as a binary Blob, a string, or a Promise for one of those things.
     * This property is observable.
     * @type {Blob|String|Promise}
     */
    this.data = undefined;

    /**
     * Gets or sets the URL from which the {@link CsvDataSourceViewModel#data} was obtained.
     * @type {String}
     */
    this.dataSourceUrl = undefined;

    /**
     * Gets or sets a value indicating whether this data source is currently loading.  This property is observable.
     * @type {Boolean}
     */
    this.isLoading = false;

    knockout.track(this, ['url', 'data', 'dataSourceUrl', 'isLoading']);
};

CsvDataSourceViewModel.prototype = inherit(GeoDataSourceViewModel.prototype);

defineProperties(CsvDataSourceViewModel.prototype, {
    /**
     * Gets the type of data member represented by this instance.
     * @memberOf CsvDataSourceViewModel.prototype
     * @type {String}
     */
    type : {
        get : function() {
            return 'csv';
        }
    },

    /**
     * Gets a human-readable name for this type of data source, 'CSV'.
     * @memberOf CsvDataSourceViewModel.prototype
     * @type {String}
     */
    typeName : {
        get : function() {
            return 'Comma-Separated Values (CSV)';
        }
    },

    /**
     * Gets the metadata associated with this data source and the server that provided it, if applicable.
     * @memberOf CsvDataSourceViewModel.prototype
     * @type {DataSourceMetadataViewModel}
     */
    metadata : {
        get : function() {
            var result = new DataSourceMetadataViewModel();
            result.isLoading = false;
            result.dataSourceErrorMessage = 'This data source does not have any details available.';
            result.serviceErrorMessage = 'This service does not have any details available.';
            return result;
        }
    }
});

/**
 * Processes the CSV data supplied via the {@link CsvDataSourceViewModel#data} property.  If
 * {@link CsvDataSourceViewModel#data} is undefined, this method downloads CSV data from 
 * {@link CsvDataSourceViewModel#url} and processes that.  It is safe to call this method multiple times.
 * It is called automatically when the data source is enabled.
 */
CsvDataSourceViewModel.prototype.load = function() {
    if ((this.url === this._loadedUrl && this.data === this._loadedData) || this.isLoading === true) {
        return;
    }

    this.isLoading = true;

    if (defined(this._tableDataSource)) {
        this._tableDataSource.destroy();
    }

    this._tableDataSource = new TableDataSource();

    var that = this;
    runLater(function() {
        that._loadedUrl = that.url;
        that._loadedData = that.data;

        if (defined(that.data)) {
            when(that.data, function(data) {
                if (data instanceof Blob) {
                    readText(data).then(function(text) {
                        that._tableDataSource.loadText(text);

                        that.clock = that._tableDataSource.clock;
                        that.rectangle = that._tableDataSource.dataset.getExtent();

                        that.isLoading = false;
                    });
                } else if (data instanceof String) {
                    that._tableDataSource.loadText(data);

                    that.clock = that._tableDataSource.clock;
                    that.rectangle = that._tableDataSource.dataset.getExtent();

                    that.isLoading = false;
                } else {
                    that.context.error.raiseEvent(new GeoDataCatalogError({
                        sender: that,
                        title: 'Unexpected type of CSV data',
                        message: '\
    CsvDataSourceViewModel.data is expected to be a Blob, File, or String, but it was not any of these. \
    This may indicate a bug in National Map or incorrect use of the National Map API. \
    If you believe it is a bug in National Map, please report it by emailing \
    <a href="mailto:nationalmap@lists.nicta.com.au">nationalmap@lists.nicta.com.au</a>.'
                    }));
                }
            }).otherwise(function() {
                that.isLoading = false;
            });
        } else if (defined(that.url)) {
            that._tableDataSource.loadUrl(proxyUrl(that, that.url)).then(function() {
                that.clock = that._tableDataSource.clock;
                that.rectangle = that._tableDataSource.dataset.getExtent();
                that.isLoading = false;
            });
        }
    });
};

CsvDataSourceViewModel.prototype._enableInCesium = function() {
};

CsvDataSourceViewModel.prototype._disableInCesium = function() {
};

CsvDataSourceViewModel.prototype._showInCesium = function() {
    var dataSources = this.context.cesiumViewer.dataSources;
    if (dataSources.contains(this._tableDataSource)) {
        throw new DeveloperError('This data source is already shown.');
    }

    dataSources.add(this._tableDataSource);
};

CsvDataSourceViewModel.prototype._hideInCesium = function() {
    var dataSources = this.context.cesiumViewer.dataSources;
    if (!dataSources.contains(this._tableDataSource)) {
        throw new DeveloperError('This data source is not shown.');
    }

    dataSources.remove(this._tableDataSource, false);
};

CsvDataSourceViewModel.prototype._enableInLeaflet = function() {
};

CsvDataSourceViewModel.prototype._disableInLeaflet = function() {
};

CsvDataSourceViewModel.prototype._showInLeaflet = function() {
    var dataSources = this.context.leafletMap.dataSources;
    if (dataSources.contains(this._tableDataSource)) {
        throw new DeveloperError('This data source is already shown.');
    }

    dataSources.add(this._tableDataSource);
};

CsvDataSourceViewModel.prototype._hideInLeaflet = function() {
    var dataSources = this.context.leafletMap.dataSources;
    if (!dataSources.contains(this._tableDataSource)) {
        throw new DeveloperError('This data source is not shown.');
    }

    dataSources.remove(this._tableDataSource, false);
};

function proxyUrl(context, url) {
    if (defined(context.corsProxy) && context.corsProxy.shouldUseProxy(url)) {
        return context.corsProxy.getURL(url);
    }

    return url;
}

module.exports = CsvDataSourceViewModel;
