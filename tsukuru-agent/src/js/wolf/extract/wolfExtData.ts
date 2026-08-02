import { writeFileSync, readFileSync } from 'fs'
import zlib from 'zlib'
import {encode, decode} from '@msgpack/msgpack'
import { ctx } from '../../../core/context';

const WolfExtDataParser = {
    create: (dir:string)=>{
        writeFileSync(dir,zlib.deflateSync(Buffer.from(encode({
            ext: ctx().wolf.extData,
            cache: ctx().wolf.cache,
            meta: ctx().wolf.metadata
        }))))
    },
    read:(dir:string) =>{
        const ca =  decode(zlib.inflateSync(readFileSync(dir))) as any
        ctx().wolf.extData = ca.ext
        ctx().wolf.metadata = ca.meta
        ctx().wolf.cache = ca.cache
    }
}

export default WolfExtDataParser