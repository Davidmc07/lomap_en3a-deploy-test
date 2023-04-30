import { QueryEngine } from '@comunica/query-sparql-solid';
import { buildThing, createAclFromFallbackAcl, createSolidDataset, createThing, getFallbackAcl, getFileWithAcl, getLinkedResourceUrlAll, getSolidDataset, getSolidDatasetWithAcl, getThing, overwriteFile, saveAclFor, saveSolidDatasetAt, setPublicDefaultAccess, setThing, SolidDataset, Thing, WithAccessibleAcl, WithAcl, WithFallbackAcl, WithResourceInfo, WithServerResourceInfo } from '@inrupt/solid-client';
import Map from '../../domain/Map';
import Assembler from './Assembler';
import SolidSessionManager from './SolidSessionManager';
import Placemark from '../../domain/Placemark';
import Place from '../../domain/Place';
import { universalAccess as access } from "@inrupt/solid-client";
import PlaceComment from '../../domain/Place/PlaceComment';
import PlaceRating from '../../domain/Place/PlaceRating';
import FriendManager from './FriendManager';
import User from '../../domain/User';
import Group from '../../domain/Group';
import { RDF, RDFS } from '@inrupt/vocab-common-rdf';

export default class PODManager {
    private sessionManager: SolidSessionManager  = SolidSessionManager.getManager();
    private friends: FriendManager = new FriendManager();


    public async savePlace(place:Place): Promise<void> {
        let path:string = this.getBaseUrl() + '/data/places/' + place.uuid;

        await this.saveDataset(path+"/details", Assembler.placeToDataset(place));
        await this.saveDataset(path+"/comments", createSolidDataset(), true);
        await this.saveDataset(path+"/images", createSolidDataset(), true);
        await this.saveDataset(path+"/reviews", createSolidDataset(), true);
        await this.createAcl(path+'/');
        place.photos.forEach(async img => await this.addImage(img, place));
    }

    public async comment(comment: PlaceComment, place: Place) {
        let commentPath: string = this.getBaseUrl() + "/data/interactions/comments/"+comment.id;
        await this.addCommentToUser(comment);
        await this.addCommentToPlace(place.uuid, commentPath);
    }

    private async addCommentToUser(comment: PlaceComment) {
        let commentPath: string = this.getBaseUrl() + "/data/interactions/comments/" + comment.id;
        await this.saveDataset(commentPath, Assembler.commentToDataset(comment), true);
        await this.setPublicAccess(commentPath, true);
    }

    private async addCommentToPlace(placeId: string, commentUrl: string) {
        let commentsPath: string = this.getBaseUrl() + "/data/places/" + placeId + "/comments";
        let placeComments = await getSolidDataset(commentsPath, {fetch: this.sessionManager.getSessionFetch()});

        placeComments = setThing(placeComments, Assembler.urlToReference(commentUrl))
        await this.saveDataset(commentsPath, placeComments);
    }

    public async getComments(placeUrl: string) {
        let engine = new QueryEngine();
        engine.invalidateHttpCache();
        let query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?url
            WHERE {
                ?s schema:URL ?url .
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext([placeUrl+"/comments"]));
        let urls: string[] = [];
        await result.toArray().then(r => {
            urls = r.map(binding => binding.get("url")?.value as string);
        });

        query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?user ?comment ?id
            WHERE {
                ?s schema:accountId ?user ;
                   schema:description ?comment ;
                   schema:identifier ?id .
            }
        `;
        result = await engine.queryBindings(query, this.getQueryContext(urls));
        return await result.toArray().then(r => {
            return Assembler.toPlaceComments(r);
        });
        
    }

    public async addImage(image: File, place: Place) {
        let imagePath: string = this.getBaseUrl() + "/data/interactions/images/"+ crypto.randomUUID();
        await this.addImageToUser(image, imagePath);
        await this.addImageToPlace(place.uuid, imagePath);
    }

    private async addImageToUser(image: File, imageUrl: string) {
        try {
            await overwriteFile(
                imageUrl,
                image,
                {contentType: image.type, fetch: this.sessionManager.getSessionFetch()}
            );
            await this.createFileAcl(imageUrl)
            await this.setPublicAccess(imageUrl, true);
        } catch (err) {
            console.log(err);
        }
    }

    private async addImageToPlace(placeId: string, imageUrl: string) {
        let imagesPath: string = this.getBaseUrl() + "/data/places/" + placeId + "/images";
        let placeImages = await getSolidDataset(imagesPath, {fetch: this.sessionManager.getSessionFetch()});

        placeImages = setThing(placeImages, Assembler.urlToReference(imageUrl))
        await this.saveDataset(imagesPath, placeImages);
    }

    public async getImageUrls(placeUrl: string) {
        let engine = new QueryEngine();
        engine.invalidateHttpCache();
        let query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?url
            WHERE {
                ?s schema:URL ?url .
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext([placeUrl+"/images"]));

        return await result.toArray().then(r => {
            console.log(r)
            return r.map(binding => binding.get("url")?.value as string);
        });
    }

    public async createAcl(path:string) {
        let dataset = await getSolidDatasetWithAcl(path, {fetch:this.sessionManager.getSessionFetch()});
        await this.createNewAcl(dataset, path);
    }

    public async createFileAcl(path:string) {
        let file = await getFileWithAcl(path, {fetch:this.sessionManager.getSessionFetch()});
        await this.createNewAcl(file, path);
    }

    public async setDefaultFolderPermissions(path:string, permissions:any) {
        let fetch = {fetch:this.sessionManager.getSessionFetch()};
        let folder = await getSolidDatasetWithAcl(path, fetch);
        let acl = await this.createNewAcl(folder, path);

        acl = setPublicDefaultAccess(acl, permissions);
        await saveAclFor({internal_resourceInfo: this.getResourceInfo(path,folder)}, acl, fetch);
    }

    private async createNewAcl(resource:any, path:string) {
        let fallbackAcl = getFallbackAcl(resource);
        let resourceInfo = this.getResourceInfo(path, resource);

        let acl = createAclFromFallbackAcl(
            this.getResourceWithFallbackAcl(resourceInfo, fallbackAcl)
        );
        await saveAclFor({internal_resourceInfo: resourceInfo}, acl, {fetch:this.sessionManager.getSessionFetch()});
        return acl;
    }

    private getResourceInfo(path:string, resource:any) {
        let linkedResources = getLinkedResourceUrlAll(resource);
        return {
            sourceIri: path, 
            isRawData: false, 
            linkedResources: linkedResources,
            aclUrl: path + '.acl' 
        };
    }

    private getResourceWithFallbackAcl(resourceInfo:any, fallbackAcl:any):any {
        return {
            internal_resourceInfo: resourceInfo,
            internal_acl: { 
                resourceAcl: null, 
                fallbackAcl: fallbackAcl 
            }
        }
    }

    /**
     * Saves a map to the user's POD
     * 
     * @param map the map to be saved
     * @returns wether the map could be saved
     */
    public async saveMap(map:Map): Promise<void> {
        let path:string = this.getBaseUrl() + '/data/maps/' + map.getId();
        let userMaps:string = this.getBaseUrl() + '/user/maps';
        let urlThing = Assembler.urlToReference(path);

        await this.saveDataset(path, Assembler.mapToDataset(map), true);

        await getSolidDataset(userMaps, {fetch: this.sessionManager.getSessionFetch()})
            .then(async dataset => {
                await this.saveDataset(userMaps, setThing(dataset, urlThing));
            }).catch(async () => {
                await this.saveDataset(userMaps, setThing(createSolidDataset(), urlThing));
            });
    }

    public async loadPlacemarks(map: Map, author:string=""): Promise<void> {
        let path:string = this.getBaseUrl(author) + '/data/maps/' + map.getId();
        let placemarks = await this.getPlacemarks(path);
        map.setPlacemarks(placemarks);
    }

    /**
     * Returns the details of all the maps of the user.
     * The placemarks will not be loaded.
     * 
     * @returns an array of maps containing the details to be displayed as a preview
     */
    public async getAllMaps(user:string=""): Promise<Array<Map>> {
        let path:string = this.getBaseUrl(user) + '/data/maps/';

        let urls = await this.getContainedUrls(path);
        let maps = await this.getMapPreviews(urls);
        console.log(maps)
        return maps;
    }

    public async getPlace(url:string): Promise<Place> {
        let engine = new QueryEngine();
        let query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?title ?desc ?lat ?lng ?id
            WHERE {
                ?place schema:name ?title ;
                       schema:description ?desc ;
                       schema:latitude ?lat ;
                       schema:longitude ?lng ;  
                       schema:identifier ?id .  
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext([url+"/details"]));
        return await result.toArray().then(r => {return Assembler.toPlace(r[0]);});
    }

    /**
     * Returns the urls of all the resources in the given path
     * 
     * @param path the path in which the urls will be searched
     * @returns the urls of all the resources in the given path
     */
    private async getContainedUrls(path: string): Promise<any[]> {
        let engine = new QueryEngine();
        let query = `
            PREFIX ldp: <http://www.w3.org/ns/ldp#>
            SELECT ?content
            WHERE {
                <${path}> ldp:contains ?content .
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext([path]));

        return await result.toArray().then(r => {
            return r.map(binding => binding.get("content"));
        });
    }

    /**
     * Maps the given urls to Map objects
     * 
     * @param urls the urls of the map datasets
     * @returns an array of Map objects with the details of each map
     */
    private async getMapPreviews(urls: Array<string>): Promise<Array<Map>> {
        let engine = new QueryEngine();
        let query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?id ?name ?desc
            WHERE {  
                ?details schema:identifier ?id ;
                         schema:name ?name ;
                         schema:description ?desc .  
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext(urls));
        return await result.toArray().then(r => {return Assembler.toMapPreviews(r);});
    }

    private async getPlacemarks(mapURL:string): Promise<Array<Placemark>> {
        let engine = new QueryEngine();
        let query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?title ?lat ?lng ?placeUrl ?cat
            WHERE {
                ?placemark schema:name ?title ;
                           schema:latitude ?lat ;
                           schema:longitude ?lng ;  
                           schema:url ?placeUrl ; 
                           schema:description ?cat . 
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext([mapURL]));
        return await result.toArray().then(r => {return Assembler.toPlacemarkArray(r);});
    }

    /**
     * @param sources the sources for the SPARQL query
     * @returns the context for the query
     */
    private getQueryContext(sources: Array<string>): any {
        return {sources: sources, fetch: this.sessionManager.getSessionFetch() }
    }

    /**
     * Saves a dataset in the user's POD
     * 
     * @param path the URI of the dataset
     * @param dataset the dataset to be saved
     */
    private async saveDataset(path:string, dataset:SolidDataset, createAcl:boolean=false): Promise<void> {
        let fetch = this.sessionManager.getSessionFetch();
        await saveSolidDatasetAt(path, dataset, {fetch: fetch});
        if (createAcl) {
            await this.createAcl(path);
        }
    }

    /**
     * Returns the root url of a POD
     * 
     * @param webID the webID of the POD's user
     * @returns the root URL of the POD
     */
    public getBaseUrl(webID:string=''): string {
        if (webID === '') {
            webID = this.sessionManager.getWebID();
        }
        return webID.slice(0, webID.indexOf('/profile/card#me')) + '/lomap';
    }


    public async review(review: PlaceRating, place: Place) {
        let reviewPath: string = this.getBaseUrl() + "/data/interactions/reviews/"+review.id;
        await this.addReviewToUser(review);
        await this.addReviewToPlace(place.uuid, reviewPath);
    }

    private async addReviewToUser(review: PlaceRating) {
        let reviewPath: string = this.getBaseUrl() + "/data/interactions/reviews/" + review.id;
        await this.saveDataset(reviewPath, Assembler.reviewToDataset(review), true);
        await this.setPublicAccess(reviewPath, true);
    }

    private async addReviewToPlace(placeId: string, reviewUrl: string) {
        let reviewsPath: string = this.getBaseUrl() + "/data/places/" + placeId + "/reviews";
        let placeReviews = await getSolidDataset(reviewsPath, {fetch: this.sessionManager.getSessionFetch()});

        placeReviews = setThing(placeReviews, Assembler.urlToReference(reviewUrl))
        await this.saveDataset(reviewsPath, placeReviews);
    }

    public async getScore(placeUrl: string) {
        let engine = new QueryEngine();
        engine.invalidateHttpCache();
        let query = `
            PREFIX schema: <http://schema.org/>
            SELECT DISTINCT ?url
            WHERE {
                ?s schema:URL ?url .
            }
        `;
        let result = await engine.queryBindings(query, this.getQueryContext([placeUrl+"/reviews"]));
        let urls: string[] = [];
        await result.toArray().then(r => {
            urls = r.map(binding => binding.get("url")?.value as string);
        });

        query = `
            PREFIX schema: <http://schema.org/>
            SELECT (COUNT(?user) as ?number) (AVG(?review) as ?score)
            WHERE {
                ?s schema:accountId ?user ;
                   schema:value ?review ;
                   schema:identifier ?id .
            }
        `;
        result = await engine.queryBindings(query, this.getQueryContext(urls));
        return await result.toArray().then(r => {
            return {
                reviews: Number(r[0].get("number")?.value),
                score:   Number(r[0].get("score")?.value)
            }
        });
        
    }

    public async createFriendsGroup(): Promise<void> {
        let users: User[] = await this.friends.getFriendsList();
        let group = new Group("Friends", users);
        let groupsPath = this.getBaseUrl() + "/groups";
        await this.saveDataset(groupsPath+"/friends", Assembler.groupToDataset(group));
        await this.setDefaultFolderPermissions(groupsPath+"/", {read:true, write:true});
        await this.setPublicAccess(groupsPath+"/", false, true);
    }

    public async createGroup(group: Group) {
        let webID = this.sessionManager.getWebID();
        let dataset = Assembler.groupToDataset(group);
        await this.createGroupForUser(new User("", webID), group, dataset);

        group.getMembers()
                .filter(member => member.getWebId() !== webID)
                .forEach(user => this.createGroupForUser(user, group, dataset));
    }

    private async createGroupForUser(user:User, group:Group, dataset:SolidDataset|undefined = undefined) {
        let path = this.getBaseUrl(user.getWebId()) + "/groups/" + group.getId();
        let groupDataset = dataset || Assembler.groupToDataset(group);
        await this.saveDataset(path, groupDataset);
    }

    public async getGroup(groupUrl: string): Promise<Group> {
        return (await this.getGroupsFromUrls([groupUrl]))[0];
    }

    public async getAllUserGroups(): Promise<Group[]> {
        let urls = await this.getContainedUrls(this.getBaseUrl()+'/groups/');
        return await this.getGroupsFromUrls(urls);
    }

    private async getGroupsFromUrls(urls:string[]) {
        let engine = new QueryEngine();
        engine.invalidateHttpCache();
        let query = `
            PREFIX vcard: <http://www.w3.org/2006/vcard/ns#>
            SELECT DISTINCT ?name ?id (GROUP_CONCAT(DISTINCT ?member; SEPARATOR=",") AS ?members)
            WHERE {   
                ?group vcard:Name ?name;
                       vcard:hasUID ?id ;
                       vcard:hasMember ?member .
            } 
            GROUP BY ?name ?id
        `;
        let result = await engine.queryBindings(query, this.getQueryContext(urls));

        let groups:Group[] = []
        await result.toArray().then(r => {
            r.forEach(binding =>groups.push( Assembler.toGroup(binding) ));
        });
        return groups;
    }


    public async getGroupMaps(group: Group): Promise<Map[]> {
        let webIDs = group.getMembers().map(m => m.getWebId());
        let groupUrls = webIDs.map( id => this.getBaseUrl(id)+"/groups/"+group.getId() );
        let engine = new QueryEngine();
        engine.invalidateHttpCache();
        let query = `
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            SELECT DISTINCT ?mapUrl
            WHERE {   
                ?bag rdfs:member ?mapUrl .
            } 
        `;
        let urls: string[] = [];
        let result = await engine.queryBindings(query, this.getQueryContext(groupUrls));

        return await result.toArray().then(r => {
            urls = r.map(binding => binding.get("mapUrl")?.value as string);
            console.log(urls)
            return this.getMapPreviews(urls);
        });
    }

    public async addMapToGroup(map:Map, group:Group) {
        console.log("add map to group")
        let url = this.getBaseUrl() + "/data/maps/" + map.getId();
        let otherMembers = group.getMembers().filter(m => m.getWebId() !== this.sessionManager.getWebID());
        let newGroup = new Group(group.getName(), otherMembers, group.getId());

        await this.saveMap(map);
        await this.setGroupAccess(url, newGroup, {read:true, write:true});
        console.log("inserting references")
        await this.insertMapReferences(url, group);
        console.log("finished")
        let maps = await this.getGroupMaps(group);
        maps.forEach(m => console.log(m.getId() + " " + m.getName()))
    }

    private async insertMapReferences(mapUrl:string, group:Group): Promise<void> {
        let url = this.getBaseUrl()+'/groups/'+group.getId();
        let dataset = await getSolidDataset(url, {fetch: this.sessionManager.getSessionFetch()});
        let maps = getThing(dataset, url+"#maps");
        dataset = setThing(dataset, buildThing(maps||createThing())
            .addStringNoLocale(RDFS.member, mapUrl)
            .build());

        await this.saveDataset(url, dataset);
    }

    public async setFriendsAccess(resourceUrl:string, canRead:boolean) {
        let group = await this.getGroup(this.getBaseUrl() + "/groups/friends");
        await this.setGroupAccess(resourceUrl, group, { read: canRead });
    }

    public async setGroupAccess(resourceUrl:string, group:Group, permissions:any) {
        console.log("set permissions: " + group + resourceUrl)
        for (let user of group.getMembers()) {
            console.log(user)
            await access.setAgentAccess(
                resourceUrl,
                user.getWebId(),
                permissions,
                { fetch: this.sessionManager.getSessionFetch() }
            );
        }
    }

    public async setPublicAccess(resourceUrl:string, canRead:boolean, canWrite:boolean=false) {
        await access.setPublicAccess(
            resourceUrl,
            { read: canRead, write: canWrite },
            { fetch: this.sessionManager.getSessionFetch() },
        );
    }

    public async changePlacePublicAccess(place:Place, isPublic:boolean) {
        let path:string = this.getBaseUrl() + '/data/places/' + place.uuid;

        await this.setPublicAccess(path+"/", isPublic);
        for (let dataset of ['/images', '/comments', '/reviews']) {
            await this.setPublicAccess(path + dataset, true, true);
        }
    }

}