"""Bounded process memory only. Never modifies persistent storage."""
from collections import OrderedDict
from collections.abc import MutableMapping
import gzip
import json
import sys
import threading


def retained_size(value, limit: int) -> int:
    seen=set();pending=[value];total=0
    while pending:
        item=pending.pop();identity=id(item)
        if identity in seen:continue
        seen.add(identity);total+=sys.getsizeof(item)
        if total>limit:return total
        if isinstance(item,dict):pending.extend(item.keys());pending.extend(item.values())
        elif isinstance(item,(list,tuple,set,frozenset)):pending.extend(item)
    return total


class CompressedLRU(MutableMapping):
    """Lossless JSON snapshots; decompression belongs to the active reader only."""
    def __init__(self,max_entries=90,max_bytes=24*1024*1024):
        self._store=OrderedDict();self.max_entries=max_entries;self.max_bytes=max_bytes;self.byte_size=0;self._lock=threading.RLock()
    def __len__(self):
        with self._lock:return len(self._store)
    def __iter__(self):
        with self._lock:return iter(tuple(self._store))
    def __contains__(self,key):
        with self._lock:return key in self._store
    def __getitem__(self,key):
        with self._lock:data=self._store[key]
        return json.loads(gzip.decompress(data))
    def __setitem__(self,key,value):
        data=gzip.compress(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=1,mtime=0)
        with self._lock:
            self.__delitem__(key,missing_ok=True)
            if len(data)>self.max_bytes:return
            self._store[key]=data;self.byte_size+=len(data)
            while len(self._store)>self.max_entries or self.byte_size>self.max_bytes:
                _,old=self._store.popitem(last=False);self.byte_size-=len(old)
    def __delitem__(self,key,missing_ok=False):
        with self._lock:
            if missing_ok and key not in self._store:return
            self.byte_size-=len(self._store.pop(key))
    def move_to_end(self,key,last=True):
        with self._lock:self._store.move_to_end(key,last=last)
    def popitem(self,last=True):
        with self._lock:key,data=self._store.popitem(last=last);self.byte_size-=len(data)
        return key,json.loads(gzip.decompress(data))
    def clear(self):
        with self._lock:self._store.clear();self.byte_size=0
