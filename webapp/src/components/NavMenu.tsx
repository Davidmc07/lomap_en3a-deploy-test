import React from "react";
import * as NavIcon from "react-icons/fa";
import {HiFolder} from "react-icons/hi";
import '../styles/navmenu.css';
import NavElement from "./NavElement";

/**
 * The navigation menu.
 */
const NavMenu: React.FunctionComponent = () => {
    return (
        <div className='NavMenu'>
            <NavElement url={"/map/public"} name={"Public map"} icon={<NavIcon.FaGlobeAmericas/>}/>
            <NavElement url={"/home"} name={"Home"} icon={<NavIcon.FaHome/>}/>
            <NavElement url={"/stuff"} name={"My Stuff"} icon={<HiFolder/>}/>
            <NavElement url={"/social"} name={"Social"} icon={<NavIcon.FaUserFriends/>}/>
        </div>
    )
}
export default NavMenu;