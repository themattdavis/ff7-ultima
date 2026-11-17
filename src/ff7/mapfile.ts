import {Lzss} from './lzss';
import {Parser} from 'binary-parser';

// Define parsers for reading the MAP file
const mapMeshData = new Parser()
    .uint32le('mesh_data_size')
    .buffer('mesh_data_bytes', {
        length: 'mesh_data_size'
    })

const mapMesh = new Parser()
    .uint32le('mesh_offset')
    .pointer('mesh_data', {
        type: mapMeshData,
        offset: function() {
            return (this as any).$parent.section_offset + (this as any).mesh_offset;
        }
    })

const mapSection = new Parser()
    .saveOffset('section_offset')
    .array('meshes', {
        type: mapMesh,
        length: 16
    })
    .seek(0xB800 - 16 * 4);

const mapParser = new Parser()
    .array('sections', {
        type: mapSection,
        readUntil: 'eof'
    });

const meshTriangle = new Parser()
    .uint8('vertex0Index')
    .uint8('vertex1Index')
    .uint8('vertex2Index')
    .bit3('script')
    .bit5('type')
    .uint8('uVertex0')
    .uint8('vVertex0')
    .uint8('uVertex1')
    .uint8('vVertex1')
    .uint8('uVertex2')
    .uint8('vVertex2')
    .uint16le('ids')

const meshVertex = new Parser()
    .int16le('x')
    .int16le('y')
    .int16le('z')
    .seek(2) // padding

const meshNormal = new Parser()
    .int16le('x')
    .int16le('y')
    .int16le('z')
    .seek(2) // padding

const meshParser = new Parser()
    .uint16le('numTriangles')
    .uint16le('numVertices')
    .array('triangles', {
        type: meshTriangle,
        length: 'numTriangles'
    })
    .array('vertices', {
        type: meshVertex,
        length: 'numVertices'
    })
    .array('normals', {
        type: meshNormal,
        length: 'numVertices'
    })

// TypeScript interfaces    
interface MeshData {
    mesh_offset: number;
    mesh_data: {
        mesh_data_size: number;
        mesh_data_bytes: Uint8Array; 
    }
}

interface Section {
    meshes: MeshData[];
}

interface Map {
    sections: Section[];
}

export interface Coords {
    x: number;
    y: number;
    z: number;
}

export interface Triangle {
    index: number;
    vertex0: Coords;
    vertex1: Coords;
    vertex2: Coords;
    script: number;
    type: number;
    locationId: number;
    texture: number;
    uVertex0: number;
    uVertex1: number;
    uVertex2: number;
    vVertex0: number;
    vVertex1: number;
    vVertex2: number;
    isChocobo?: boolean;
}

interface RawTriangle {
    vertex0Index: number;
    vertex1Index: number;
    vertex2Index: number;
    script: number;
    type: number;
    ids: number;
    uVertex0: number;
    uVertex1: number;
    uVertex2: number;
    vVertex0: number;
    vVertex1: number;
    vVertex2: number;
}

export interface Mesh {
    numTriangles: number;
    numVertices: number;
    triangles: Triangle[];
    vertices: Coords[];
    normals: Coords[];
}

export type BotMapType = 'overworld' | 'underwater' | 'glacier';

// Size of one terrain block (section) in the MAP/BOT files
const SECTION_SIZE = 0xB800;
// The game decompresses each mesh into a fixed 0x1200 byte slot
const MAX_DECOMPRESSED_MESH_SIZE = 0x1200;
// Triangles refer to vertices with a single byte
const MAX_VERTICES_PER_MESH = 256;

// Overworld sections 63..68 are the story-progress replacements for these base sections.
const OVERWORLD_ALT_SECTION_START = 63;
const OVERWORLD_ALT_CELLS = [50, 41, 42, 60, 47, 48];
// Story progress stage from which each replacement is used (World_ReadBlockFromMapFile)
const OVERWORLD_ALT_STAGE: Record<number, number> = { 50: 1, 41: 2, 42: 2, 60: 3, 47: 4, 48: 4 };

export class MapFile {
    public map: Map;

    constructor(mapData: Uint8Array) {
        this.map = mapParser.parse(mapData);
    }

    readMesh(sectionId: number, meshId: number) {
        const lzss = new Lzss();
        const meshData = this.map.sections[sectionId].meshes[meshId].mesh_data.mesh_data_bytes;
        const decodedMeshData = lzss.decompress(meshData);
        const mesh = meshParser.parse(decodedMeshData);

        return { 
            ...mesh, 
            triangles: mesh.triangles.map((triangle: RawTriangle, idx: number) => ({
                index: idx,
                vertex0Idx: triangle.vertex0Index,
                vertex1Idx: triangle.vertex1Index,
                vertex2Idx: triangle.vertex2Index,
                uVertex0: triangle.uVertex0,
                vVertex0: triangle.vVertex0,
                uVertex1: triangle.uVertex1,
                vVertex1: triangle.vVertex1,
                uVertex2: triangle.uVertex2,
                vVertex2: triangle.vVertex2,
                vertex0: mesh.vertices[triangle.vertex0Index],
                vertex1: mesh.vertices[triangle.vertex1Index],
                vertex2: mesh.vertices[triangle.vertex2Index],
                script: triangle.script,
                type: triangle.type,
                locationId: triangle.ids >> 9 & 0x1f,
                texture: triangle.ids & 0x1ff,
                isChocobo: triangle.ids >> 0xf & 1,
            }))
        } as Mesh;
    }

    writeMesh(sectionId: number, meshId: number, data: Mesh) {
        const length = 4 + data.triangles.length * 12 + data.vertices.length * 16
        if (length > MAX_DECOMPRESSED_MESH_SIZE) {
            throw new Error(`Mesh ${meshId} of section ${sectionId} is ${length} bytes, but the game only has room for ${MAX_DECOMPRESSED_MESH_SIZE} (0x1200). Remove some triangles or vertices.`);
        }
        if (data.vertices.length > MAX_VERTICES_PER_MESH) {
            throw new Error(`Mesh ${meshId} of section ${sectionId} has ${data.vertices.length} vertices, the maximum is ${MAX_VERTICES_PER_MESH}.`);
        }
        const out = new Uint8Array(length);
        let pos = 0;

        const setUint16 = (value: number, offset: number) => {
            out[offset] = value & 0xFF;
            out[offset + 1] = (value >> 8) & 0xFF;
        };

        setUint16(data.triangles.length, pos);
        pos += 2;
        setUint16(data.vertices.length, pos);
        pos += 2;

        const vertexIndex = (vertex: Coords) => {
            const index = data.vertices.indexOf(vertex);
            if (index === -1) {
                throw new Error(`A triangle in mesh ${meshId} of section ${sectionId} uses a vertex that is not part of the mesh.`);
            }
            return index;
        };

        data.triangles.forEach(triangle => {
            out[pos++] = vertexIndex(triangle.vertex0);
            out[pos++] = vertexIndex(triangle.vertex1);
            out[pos++] = vertexIndex(triangle.vertex2);
            out[pos++] = (triangle.script << 5) | triangle.type;
            out[pos++] = triangle.uVertex0;
            out[pos++] = triangle.vVertex0;
            out[pos++] = triangle.uVertex1;
            out[pos++] = triangle.vVertex1;
            out[pos++] = triangle.uVertex2;
            out[pos++] = triangle.vVertex2;
            const ids = (triangle.locationId << 9) | triangle.texture | (triangle.isChocobo ? 1 << 0xf : 0);
            setUint16(ids, pos);
            pos += 2;
        });

        const setInt16 = (value: number, offset: number) => {
            if (value < 0) value = 0xFFFF + value + 1;
            setUint16(value, offset);
        };

        data.vertices.forEach(vertex => {
            setInt16(vertex.x, pos);
            pos += 2;
            setInt16(vertex.y, pos);
            pos += 2;
            setInt16(vertex.z, pos);
            pos += 2;
            setInt16(0, pos);
            pos += 2;
        });

        data.normals.forEach(normal => {
            setInt16(normal.x, pos);
            pos += 2;
            setInt16(normal.y, pos);
            pos += 2;
            setInt16(normal.z, pos);
            pos += 2;
            setInt16(0, pos);
            pos += 2;
        });

        const lzss = new Lzss();
        const bytes = lzss.compress(out);
        this.map.sections[sectionId].meshes[meshId].mesh_data.mesh_data_bytes = bytes;
        this.map.sections[sectionId].meshes[meshId].mesh_data.mesh_data_size = bytes.length;
    }

    writeSection(section: Section, out: Uint8Array, pos: number) {
        // The game reads fixed 0xB800 byte blocks, so the offset table and all compressed
        // meshes (each 4 byte aligned) have to fit; otherwise they would overwrite the next block.
        let requiredSize = section.meshes.length * 4;
        for (const mesh of section.meshes) {
            requiredSize += mesh.mesh_data.mesh_data_size + 4;
            requiredSize += (requiredSize % 4 > 0) ? 4 - (requiredSize % 4) : 0;
        }
        if (requiredSize > SECTION_SIZE) {
            throw new Error(`Section needs ${requiredSize} bytes but a block is only ${SECTION_SIZE} (0xB800). The compressed meshes are ${requiredSize - SECTION_SIZE} bytes too large.`);
        }

        let offset = section.meshes.length * 4;

        const setUint32 = (value: number, offset: number) => {
            out[offset] = value & 0xFF;
            out[offset + 1] = (value >> 8) & 0xFF;
            out[offset + 2] = (value >> 16) & 0xFF;
            out[offset + 3] = (value >> 24) & 0xFF;
        };

        for (const mesh of section.meshes) {
            setUint32(offset, pos);
            offset += mesh.mesh_data.mesh_data_size + 4;
            offset += (offset % 4 > 0) ? 4 - (offset % 4) : 0;
            pos += 4;
        }

        for (const mesh of section.meshes) {
            setUint32(mesh.mesh_data.mesh_data_size, pos);
            pos += 4;
            out.set(mesh.mesh_data.mesh_data_bytes, pos);
            pos += mesh.mesh_data.mesh_data_size;
            pos += (pos % 4 > 0) ? 4 - (pos % 4) : 0;
        }
        pos += 0xB800 - offset;

        return pos;
    }

    writeMap() {
        const out = new Uint8Array(this.map.sections.length * 0xB800);
        let pos = 0;

        for (const section of this.map.sections) {
            pos = this.writeSection(section, out, pos);
        }

        // Return the Uint8Array instead of writing to file
        return out;
    }

    // Each BOT entry is a 2x2 group of sections that the game preloads around the player
    // (World_PreloadBlocksFromBot): the group anchored at (row, col) holds the sections at
    // (row, col), (row, col+1), (row+1, col) and (row+1, col+1) with the grid wrapping around.
    private botGroups(mapType: BotMapType): number[][] {
        const wrapGroup = (row: number, col: number, rows: number, cols: number, substitute?: (cell: number) => number) => {
            const group: number[] = [];
            for (let z = 0; z < 2; z++) {
                for (let x = 0; x < 2; x++) {
                    const cell = ((row + z) % rows) * cols + (col + x) % cols;
                    group.push(substitute ? substitute(cell) : cell);
                }
            }
            return group;
        };

        const groups: number[][] = [];

        if (mapType === 'underwater') {
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 3; col++) groups.push(wrapGroup(row, col, 4, 3));
            }
        } else if (mapType === 'glacier') {
            for (let row = 0; row < 2; row++) {
                for (let col = 0; col < 2; col++) groups.push(wrapGroup(row, col, 2, 2));
            }
        } else {
            // 63 regular groups, indexed row * 9 + col
            for (let row = 0; row < 7; row++) {
                for (let col = 0; col < 9; col++) groups.push(wrapGroup(row, col, 7, 9));
            }

            // 20 more groups for the story-progress blocks, placed at the indices the game
            // computes for them. Each one contains every replacement block that is active at
            // its stage, because the game picks the highest matching stage for a position.
            const extra: { index: number; row: number; col: number; stage: number }[] = [];
            for (let row = 4; row <= 5; row++) for (let col = 4; col <= 5; col++) extra.push({ index: col + row * 2 + 0x33, row, col, stage: 1 });
            for (let row = 3; row <= 4; row++) for (let col = 4; col <= 6; col++) extra.push({ index: (row - 3) * 3 + col + 0x3F, row, col, stage: 2 });
            for (let row = 5; row <= 6; row++) for (let col = 5; col <= 6; col++) extra.push({ index: col + row * 2 + 0x3A, row, col, stage: 3 });
            for (let row = 4; row <= 5; row++) for (let col = 1; col <= 3; col++) extra.push({ index: (row - 4) * 3 + col + 0x4C, row, col, stage: 4 });

            for (const { index, row, col, stage } of extra) {
                if (groups[index] !== undefined || index < 63) {
                    throw new Error(`Overworld BOT group index ${index} is used twice`);
                }
                groups[index] = wrapGroup(row, col, 7, 9, cell => {
                    const alt = OVERWORLD_ALT_CELLS.indexOf(cell);
                    return alt !== -1 && OVERWORLD_ALT_STAGE[cell] <= stage ? OVERWORLD_ALT_SECTION_START + alt : cell;
                });
            }
            for (let i = 0; i < 83; i++) {
                if (groups[i] === undefined) throw new Error(`Overworld BOT group ${i} was not generated`);
            }
        }

        return groups;
    }

    writeBot(mapType: BotMapType = 'overworld') {
        const groups = this.botGroups(mapType);
        const highestSection = Math.max(...groups.flat());
        if (highestSection >= this.map.sections.length) {
            throw new Error(`Cannot build the ${mapType} BOT file: it needs section ${highestSection} but the MAP file only has ${this.map.sections.length} sections.`);
        }

        const out = new Uint8Array(groups.length * 4 * SECTION_SIZE);
        let pos = 0;

        for (const group of groups) {
            for (const sectionId of group) {
                pos = this.writeSection(this.map.sections[sectionId], out, pos);
            }
        }

        // Return the Uint8Array instead of writing to file
        return out;
    }
}