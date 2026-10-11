import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/components/droneBuildingPhotos.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {droneBuildingPhotos,buildingBlogPhoto}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const photo=(thumb,extra={})=>({thumb,image:thumb,site:'건물 정보',link:'https://example.org/building',w:960,h:600,...extra});
test('Wikipedia building representative precedes search images and does not duplicate API lead',()=>{
 const wiki={title:'건물',thumb:'https://upload.wikimedia.org/lead.jpg',image:'https://upload.wikimedia.org/original.jpg',url:'https://ko.wikipedia.org/wiki/building'};
 const result=droneBuildingPhotos({wiki,photos:[photo('https://example.org/search.jpg'),photo(wiki.thumb)]});
 assert.equal(result[0].thumb,wiki.thumb);assert.equal(result[0].image,wiki.image);assert.equal(result[0].site,'위키백과');assert.equal(result.length,2);
});
test('missing wiki photo retains non-blog building photo fallbacks',()=>{
 const p=photo('https://example.org/exterior.jpg');assert.deepEqual(droneBuildingPhotos({wiki:null,photos:[p]}),[p]);
});
test('Naver blog pages, image CDN, redirects and other blogs cannot become hero fallbacks',()=>{
 for(const url of ['https://blog.naver.com/a/1','https://m.blog.naver.com/a','https://postfiles.pstatic.net/photo.jpg','https://blogthumb.pstatic.net/p.jpg','https://a.tistory.com/1','https://naver.me/abc'])assert.equal(buildingBlogPhoto(photo('https://example.org/p.jpg',{link:url})),true,url);
 assert.equal(buildingBlogPhoto(photo('https://example.org/p.jpg',{site:'네이버 블로그'})),true);
});
test('neighbourhood Commons pictures are omitted; missing images do not fabricate a photo',()=>{
 assert.deepEqual(droneBuildingPhotos({wiki:null,photos:[photo('https://upload.wikimedia.org/other.jpg',{near:true})]}),[]);
 assert.deepEqual(droneBuildingPhotos(null),[]);
});
