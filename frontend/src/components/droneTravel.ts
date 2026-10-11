import {navigate} from '../router';
import {placeDisplayTitle,type DronePlace} from './dronePlaces';

type IncomingTravel={url:string;name:string;started:number;from:string};
// One in-memory handoff when a map/3D flight opens the shared drone destination.
let incoming:IncomingTravel|null=null;
export function droneDestinationUrl(target:DronePlace,anchor:string,query=new URLSearchParams()){
  const q=new URLSearchParams(query);
  q.set('complex',anchor);q.set('lat',target.lat.toFixed(6));q.set('lon',target.lon.toFixed(6));
  q.set('place',target.title);q.set('address',target.address);q.set('parcel',target.parcel);q.set('kind',target.kind);
  return '/drone-explore?'+q.toString();
}
export function incomingDroneTravel(url:string){
  return incoming?.url===url&&performance.now()-incoming.started<120000?incoming:null;
}
export function consumeDroneTravel(travel:IncomingTravel|null){if(incoming===travel)incoming=null;}
export function moveFromBuildingView(target:DronePlace,anchor:string,hour:number,weather:string){
  const query=new URLSearchParams({hour:String(hour),weather}),source=new URLSearchParams(location.search);
  for(const name of ['fps','dronedebug'])if(source.get(name)==='1')query.set(name,'1');
  const url=droneDestinationUrl(target,anchor,query);
  incoming={url,name:placeDisplayTitle(target),started:performance.now(),from:location.pathname+location.search};
  navigate(url);
}
