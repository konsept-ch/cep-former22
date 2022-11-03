const moduleName = 'cloneRow'

export class CloneRowModule {
    constructor() {
        this.name = 'CloneRowModule'
        this.prefix = '%'
        this.rows = []
    }
    set(obj) {
        if (obj.data) this.data = obj.data
    }
    matchers() {
        return [[this.prefix, moduleName]]
    }
    isPlaceholder(part) {
        return part.type === 'placeholder' && part.module === moduleName
    }
    postparse(parsed) {
        let rowStart = -1
        let placeholders = 0
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
                        parts: [...tmp],
                    })
                    rowStart = -1
                }
            } else if (rowStart >= 0) {
                tmp.push(part)
                if (this.isPlaceholder(part)) {
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

            const count = this.data[row.parts.find((p) => this.isPlaceholder(p)).value].length

            let xml = ''
            // eslint-disable-next-line no-plusplus
            for (let i = 0; i < count; ++i) {
                for (const p of row.parts) {
                    if (this.isPlaceholder(p)) {
                        const value = this.data[p.value]
                        xml += value ? value[i] : ''
                    } else {
                        xml += p.value
                    }
                }
            }
            row.parts.shift()
            return { value: xml }
        }

        return null
    }
}
