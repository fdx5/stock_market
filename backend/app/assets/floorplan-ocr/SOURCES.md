# Floorplan OCR language models

Free Tesseract LSTM integer models, Apache-2.0. These exact files were used for the local
Korean room-name and dimension recognition checks. Packaging them avoids language-model
downloads on the first apartment click and keeps development/production models consistent.

- Source project: https://github.com/naptha/tesseract.js-data
- Upstream models and licence: https://github.com/tesseract-ocr/tessdata_best
- Distribution: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/{eng,kor}/4.0.0_best_int/`
- eng.traineddata, 5,199,098 bytes, SHA-256 `5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`
- kor.traineddata, 2,208,378 bytes, SHA-256 `ec1749377d49ac38fb3d3cd05dd5e2a53359d329f359762bc638a81132109992`

The runtime uses the operating system's Tesseract executable (LSTM OEM 1), with no AI API
key, subscription invocation, external token or metered vision service.
