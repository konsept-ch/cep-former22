const moduleName = 'cloneRow'

export class CloneRowModule {
    constructor() {
        this.name = 'CloneRowModule'
        this.prefix = '%'
        this.rows = []
    }
    optionsTransformer(options, docxtemplater) {
        this.fileTypeConfig = docxtemplater.fileTypeConfig
        return options
    }
    set(obj) {
        if (obj.compiled) this.compiled = obj.compiled
        if (obj.data != null) this.data = obj.data

        //console.log(this.compiled)
        //console.log(this.data)
    }
    matchers() {
        return [[this.prefix, moduleName]]
    }
    postparse(parsed) {
        let rowStart = -1
        let placeholders = 0
        let count = 0
        let tmp = []
        for (const part of parsed) {
            if (part.type === 'tag' && part.tag === 'w:tr') {
                if (part.position === 'start') {
                    tmp = [part]
                    rowStart = part.lIndex
                } else if (placeholders > 0) {
                    tmp.push(part)
                    this.rows.push({
                        start: rowStart,
                        end: part.lIndex,
                        parts: tmp,
                        count,
                    })
                    rowStart = -1
                }
            } else if (rowStart >= 0) {
                tmp.push(part)
                if (part.type === 'placeholder' && part.module === moduleName) {
                    //console.log(this.data)
                    const value = this.data[part.value]
                    count = value ? value.length : 0
                    // eslint-disable-next-line no-plusplus
                    ++placeholders
                }
            }
        }
    }
    render(part) {
        if (this.rows.length === 0) return null

        const row = this.rows[0]
        if (part.lIndex >= row.start && part.lIndex <= row.end) {
            if (part.lIndex !== row.end) return { value: '' }

            let xml = ''
            // eslint-disable-next-line no-plusplus
            for (let i = 0; i < row.count; ++i) {
                for (const p of row.parts) {
                    if (p.type === 'placeholder' && p.module === moduleName) {
                        const value = this.data[part.value]
                        xml += value ? value[i] : ''
                    } else {
                        xml += p.value
                    }
                }
            }
            row.parts.shift()
            return { value: xml }
        }

        return { value: part.value }
    }
}
