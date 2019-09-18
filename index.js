// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
    .subClass({ imageMagick: true }); // Enable ImageMagick integration.

// constants
var MAX_WIDTH = 1440;
var MAX_HEIGHT = 890;

// get reference to S3 client 
var s3 = new AWS.S3({
    apiVersion: '2006-03-01'
});

/* The following example retrieves object list. The request specifies max keys to limit response to include only 2 object keys.  */
exports.handler = function (event, context, callback) {
    optimizeFolderImages(callback);
};

function optimizeFolderImages(callback) {
    var params = {
        Bucket: "YOUR-S3-BUCKET-NAME",
        MaxKeys: 5000,
        Prefix: 'folder/'
    };

    s3.listObjectsV2(params, function (err, data) {
        if (err) {
            callback(null, { statusCode: 400, body: 'listObjectsV2 error - ' + err.stack });
        }
        else {
            data.Contents.forEach(file => {
                callback(null, { statusCode: 200, body: 'Successfully resized image for ' + file.Key });
                optimizeImage(callback, params.Bucket, file);
            });
        }
    });
}

function optimizeImage(callback, Bucket, file) {

    var srcBucket = Bucket;//event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey = file.Key;
    var dstBucket = Bucket;
    var dstKey = file.Key;

    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        console.log('Error - Could not determine the image type for key ', file.Key);
        return;
    }
    else if (typeMatch[1].toLowerCase() != "jpeg" && typeMatch[1].toLowerCase() != "jpg" && typeMatch[1].toLowerCase() != "png") {
        console.log('Error - Unsupported image type for key ', file.Key);
        return;
    }
    else {

        // Download the image from S3, optimize, and upload to destination S3 bucket.
        async.waterfall([
            function download(next) {
                // Download the image from S3 into a buffer.
                s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                },
                    next);
            },
            function transform(response, next) {
                gm(response.Body).size(function (err, size) {
                    // Infer the scaling factor to avoid stretching the image unnaturally.

                    if (err) {
                        console.log('optimize error - ', err);
                    }

                    if (size === undefined) {
                        console.log('Error - undefined size for image - ', file.Key);
                        return;
                    }

                    var scalingFactor = Math.min(
                        MAX_WIDTH / size.width,
                        MAX_HEIGHT / size.height
                    );
                    var width = scalingFactor * size.width;
                    var height = scalingFactor * size.height;

                    // small image validation
                    if (size.width < MAX_WIDTH || size.height < MAX_HEIGHT) {
                        console.log('Error - Image size too small for image - ', file.Key);
                        return;
                    }


                    // Transform the image buffer in memory
                    this.resize(width, height, '^')
                        .gravity('Center')
                        // .crop(WEB_WIDTH_MAX, WEB_HEIGHT_MAX)
                        .quality('80')
                        //.strip('true')
                        //.colorspace('RGB')
                        .interlace()
                        //.samplingFactor(16,16)
                        .toBuffer('jpeg', function (err, buffer) {
                            if (err) {
                                console.log('Resize error for key ${file.Key} - ', err);
                                next(err);
                            }
                            else {
                                next(null, response, buffer);
                            }
                        })
                }), function (err, data) {
                    if (err) {
                        console.log('GM size error ', err.stack);
                    } else {
                        next(null, response);
                    }
                }
            },
            function upload(response, buffer, next) {
                // Stream the transformed image to a different S3 bucket.
                s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: buffer,
                    ContentType: response.ContentType,
                    ACL: 'public-read'
                }, function (err, data) {
                    if (err) {
                        console.log('Upload error ', err.stack);
                    } else {
                        next(null, response, buffer);
                    }
                });
            }
        ],
            function (err) {
                if (err) {
                    console.log('Error - Unable to resize image. error - ', err);
                } else {
                    console.log('Success - Successfully resized image ', srcKey);
                }

            }
        );
    }
}